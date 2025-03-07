/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { IFluidHandle } from "@fluidframework/core-interfaces";
import { IFluidSerializer } from "@fluidframework/shared-object-base";
import { ISequencedDocumentMessage, MessageType } from "@fluidframework/protocol-definitions";
import {
	IFluidDataStoreRuntime,
	IChannelStorageService,
} from "@fluidframework/datastore-definitions";
import { ISummaryTreeWithStats } from "@fluidframework/runtime-definitions";
import type { IEventThisPlaceHolder, ITelemetryLogger } from "@fluidframework/common-definitions";
import { assert, TypedEventEmitter, unreachableCase } from "@fluidframework/common-utils";
import { LoggingError } from "@fluidframework/telemetry-utils";
import { UsageError } from "@fluidframework/container-utils";
import { IIntegerRange } from "./base";
import { RedBlackTree } from "./collections";
import { UnassignedSequenceNumber, UniversalSequenceNumber } from "./constants";
import { LocalReferencePosition } from "./localReference";
import {
	CollaborationWindow,
	compareStrings,
	IConsensusInfo,
	ISegment,
	ISegmentAction,
	Marker,
	SegmentGroup,
} from "./mergeTreeNodes";
import {
	IMergeTreeDeltaCallbackArgs,
	IMergeTreeMaintenanceCallbackArgs,
} from "./mergeTreeDeltaCallback";
import {
	createAnnotateMarkerOp,
	createAnnotateRangeOp,
	createGroupOp,
	createInsertSegmentOp,
	createRemoveRangeOp,
} from "./opBuilder";
import {
	ICombiningOp,
	IJSONSegment,
	IMergeTreeAnnotateMsg,
	IMergeTreeDeltaOp,
	IMergeTreeGroupMsg,
	IMergeTreeInsertMsg,
	IMergeTreeRemoveMsg,
	IMergeTreeOp,
	IRelativePosition,
	MergeTreeDeltaType,
	ReferenceType,
} from "./ops";
import { PropertySet } from "./properties";
import { SnapshotLegacy } from "./snapshotlegacy";
import { SnapshotLoader } from "./snapshotLoader";
import { IMergeTreeTextHelper } from "./textSegment";
import { SnapshotV1 } from "./snapshotV1";
import { ReferencePosition, RangeStackMap, DetachedReferencePosition } from "./referencePositions";
import { MergeTree } from "./mergeTree";
import { MergeTreeTextHelper } from "./MergeTreeTextHelper";
import { walkAllChildSegments } from "./mergeTreeNodeWalk";
import { IMergeTreeClientSequenceArgs, IMergeTreeDeltaOpArgs } from "./index";

type IMergeTreeDeltaRemoteOpArgs = Omit<IMergeTreeDeltaOpArgs, "sequencedMessage"> &
	Required<Pick<IMergeTreeDeltaOpArgs, "sequencedMessage">>;

/**
 * Emitted before this client's merge-tree normalizes its segments on reconnect, potentially
 * ordering them. Useful for DDS-like consumers built atop the merge-tree to compute any information
 * they need for rebasing their ops on reconnection.
 *
 * @internal
 */
export interface IClientEvents {
	(event: "normalize", listener: (target: IEventThisPlaceHolder) => void);
	(
		event: "delta",
		listener: (
			opArgs: IMergeTreeDeltaOpArgs,
			deltaArgs: IMergeTreeDeltaCallbackArgs,
			target: IEventThisPlaceHolder,
		) => void,
	);
	(
		event: "maintenance",
		listener: (
			args: IMergeTreeMaintenanceCallbackArgs,
			deltaArgs: IMergeTreeDeltaOpArgs | undefined,
			target: IEventThisPlaceHolder,
		) => void,
	);
}

export class Client extends TypedEventEmitter<IClientEvents> {
	public longClientId: string | undefined;

	private readonly _mergeTree: MergeTree;

	private readonly clientNameToIds = new RedBlackTree<string, number>(compareStrings);
	private readonly shortClientIdMap: string[] = [];
	private readonly pendingConsensus = new Map<string, IConsensusInfo>();

	constructor(
		// Passing this callback would be unnecessary if Client were merged with SharedSegmentSequence
		public readonly specToSegment: (spec: IJSONSegment) => ISegment,
		public readonly logger: ITelemetryLogger,
		options?: PropertySet,
	) {
		super();
		this._mergeTree = new MergeTree(options);
		this._mergeTree.mergeTreeDeltaCallback = (opArgs, deltaArgs) => {
			this.emit("delta", opArgs, deltaArgs, this);
		};
		this._mergeTree.mergeTreeMaintenanceCallback = (args, opArgs) => {
			this.emit("maintenance", args, opArgs, this);
		};

		if (options?.attribution?.track) {
			const policy = this._mergeTree?.attributionPolicy;
			if (policy === undefined) {
				throw new UsageError(
					"Attribution policy must be provided when attribution tracking is requested.",
				);
			}
			policy.attach(this);
		}
	}

	/**
	 * The merge tree maintains a queue of segment groups for each local operation.
	 * These segment groups track segments modified by an operation.
	 * This method peeks the tail of that queue, and returns the segments groups there.
	 * It is used to get the segment group(s) for the previous operations.
	 * @param count - The number segment groups to get peek from the tail of the queue. Default 1.
	 */
	public peekPendingSegmentGroups(count: number = 1): SegmentGroup | SegmentGroup[] | undefined {
		const pending = this._mergeTree.pendingSegments;
		let node = pending?.last;
		if (count === 1 || pending === undefined) {
			return node?.data;
		}
		const taken: SegmentGroup[] = new Array(Math.min(count, pending.length));
		for (let i = taken.length - 1; i >= 0; i--) {
			taken[i] = node!.data;
			node = node!.prev;
		}
		return taken;
	}

	/**
	 * Annotate a marker and call the callback on consensus.
	 * @param marker - The marker to annotate
	 * @param props - The properties to annotate the marker with
	 * @param consensusCallback - The callback called when consensus is reached
	 * @returns The annotate op if valid, otherwise undefined
	 */
	public annotateMarkerNotifyConsensus(
		marker: Marker,
		props: PropertySet,
		consensusCallback: (m: Marker) => void,
	): IMergeTreeAnnotateMsg | undefined {
		const combiningOp: ICombiningOp = {
			name: "consensus",
		};

		const annotateOp = this.annotateMarker(marker, props, combiningOp);

		if (annotateOp) {
			const consensusInfo: IConsensusInfo = {
				callback: consensusCallback,
				marker,
			};
			this.pendingConsensus.set(marker.getId()!, consensusInfo);
			return annotateOp;
		} else {
			return undefined;
		}
	}
	/**
	 * Annotates the markers with the provided properties
	 * @param marker - The marker to annotate
	 * @param props - The properties to annotate the marker with
	 * @param combiningOp - Optional. Specifies how to combine values for the property, such as "incr" for increment.
	 * @returns The annotate op if valid, otherwise undefined
	 */
	public annotateMarker(
		marker: Marker,
		props: PropertySet,
		combiningOp?: ICombiningOp,
	): IMergeTreeAnnotateMsg | undefined {
		const annotateOp = createAnnotateMarkerOp(marker, props, combiningOp)!;

		return this.applyAnnotateRangeOp({ op: annotateOp }) ? annotateOp : undefined;
	}
	/**
	 * Annotates the range with the provided properties
	 * @param start - The inclusive start position of the range to annotate
	 * @param end - The exclusive end position of the range to annotate
	 * @param props - The properties to annotate the range with
	 * @param combiningOp - Specifies how to combine values for the property, such as "incr" for increment.
	 * @returns The annotate op if valid, otherwise undefined
	 */
	public annotateRangeLocal(
		start: number,
		end: number,
		props: PropertySet,
		combiningOp: ICombiningOp | undefined,
	): IMergeTreeAnnotateMsg | undefined {
		const annotateOp = createAnnotateRangeOp(start, end, props, combiningOp);

		if (this.applyAnnotateRangeOp({ op: annotateOp })) {
			return annotateOp;
		}
		return undefined;
	}

	/**
	 * Removes the range
	 *
	 * @param start - The inclusive start of the range to remove
	 * @param end - The exclusive end of the range to remove
	 */
	public removeRangeLocal(start: number, end: number): IMergeTreeRemoveMsg {
		const removeOp = createRemoveRangeOp(start, end);
		this.applyRemoveRangeOp({ op: removeOp });
		return removeOp;
	}

	/**
	 * @param pos - The position to insert the segment at
	 * @param segment - The segment to insert
	 */
	public insertSegmentLocal(pos: number, segment: ISegment): IMergeTreeInsertMsg | undefined {
		if (segment.cachedLength <= 0) {
			return undefined;
		}
		const insertOp = createInsertSegmentOp(pos, segment);
		if (this.applyInsertOp({ op: insertOp })) {
			return insertOp;
		}
		return undefined;
	}

	/**
	 * @param refPos - The reference position to insert the segment at
	 * @param segment - The segment to insert
	 */
	public insertAtReferencePositionLocal(
		refPos: ReferencePosition,
		segment: ISegment,
	): IMergeTreeInsertMsg | undefined {
		const pos = this._mergeTree.referencePositionToLocalPosition(
			refPos,
			this.getCurrentSeq(),
			this.getClientId(),
		);

		if (pos === DetachedReferencePosition) {
			return undefined;
		}
		const op = createInsertSegmentOp(pos, segment);

		const opArgs = { op };
		this._mergeTree.insertAtReferencePosition(refPos, segment, opArgs);
		return op;
	}

	public walkSegments<TClientData>(
		handler: ISegmentAction<TClientData>,
		start: number | undefined,
		end: number | undefined,
		accum: TClientData,
		splitRange?: boolean,
	): void;
	public walkSegments<undefined>(
		handler: ISegmentAction<undefined>,
		start?: number,
		end?: number,
		accum?: undefined,
		splitRange?: boolean,
	): void;
	public walkSegments<TClientData>(
		handler: ISegmentAction<TClientData>,
		start: number | undefined,
		end: number | undefined,
		accum: TClientData,
		splitRange: boolean = false,
	): void {
		this._mergeTree.mapRange(
			handler,
			this.getCurrentSeq(),
			this.getClientId(),
			accum,
			start,
			end,
			splitRange,
		);
	}

	protected walkAllSegments<TClientData>(
		action: (segment: ISegment, accum?: TClientData) => boolean,
		accum?: TClientData,
	): boolean {
		return walkAllChildSegments(
			this._mergeTree.root,
			accum === undefined ? action : (seg) => action(seg, accum),
		);
	}

	/**
	 * Serializes the data required for garbage collection. The IFluidHandles stored in all segments that haven't
	 * been removed represent routes to other objects. We serialize the data in these segments using the passed in
	 * serializer which keeps track of all serialized handles.
	 */
	public serializeGCData(
		handle: IFluidHandle,
		handleCollectingSerializer: IFluidSerializer,
	): void {
		let localInserts = 0;
		let localRemoves = 0;
		walkAllChildSegments(this._mergeTree.root, (seg) => {
			if (seg.seq === UnassignedSequenceNumber) {
				localInserts++;
			}
			if (seg.removedSeq === UnassignedSequenceNumber) {
				localRemoves++;
			}
			// Only serialize segments that have not been removed.
			if (seg.removedSeq === undefined) {
				handleCollectingSerializer.stringify(seg.clone().toJSONObject(), handle);
			}
			return true;
		});

		if (localInserts > 0 || localRemoves > 0) {
			this.logger.sendErrorEvent({
				eventName: "LocalEditsInProcessGCData",
				localInserts,
				localRemoves,
			});
		}
	}

	public getCollabWindow(): CollaborationWindow {
		return this._mergeTree.collabWindow;
	}

	/**
	 * Returns the current position of a segment, and -1 if the segment
	 * does not exist in this merge tree
	 * @param segment - The segment to get the position of
	 */
	public getPosition(segment: ISegment | undefined, localSeq?: number): number {
		if (segment?.parent === undefined) {
			return -1;
		}
		return this._mergeTree.getPosition(
			segment,
			this.getCurrentSeq(),
			this.getClientId(),
			localSeq,
		);
	}

	/**
	 * Creates a `LocalReferencePosition` on this client. If the refType does not include ReferenceType.Transient,
	 * the returned reference will be added to the localRefs on the provided segment.
	 * @param segment - Segment to add the local reference on
	 * @param offset - Offset on the segment at which to place the local reference
	 * @param refType - ReferenceType for the created local reference
	 * @param properties - PropertySet to place on the created local reference
	 */
	public createLocalReferencePosition(
		segment: ISegment,
		offset: number | undefined,
		refType: ReferenceType,
		properties: PropertySet | undefined,
	): LocalReferencePosition {
		return this._mergeTree.createLocalReferencePosition(
			segment,
			offset ?? 0,
			refType,
			properties,
		);
	}

	/**
	 * Removes a `LocalReferencePosition` from this client.
	 */
	public removeLocalReferencePosition(lref: LocalReferencePosition) {
		return this._mergeTree.removeLocalReferencePosition(lref);
	}

	/**
	 * Resolves a `ReferencePosition` into a character position using this client's perspective.
	 */
	public localReferencePositionToPosition(lref: ReferencePosition): number {
		return this._mergeTree.referencePositionToLocalPosition(lref);
	}

	/**
	 * Given a position specified relative to a marker id, lookup the marker
	 * and convert the position to a character position.
	 * @param relativePos - Id of marker (may be indirect) and whether position is before or after marker.
	 */
	public posFromRelativePos(relativePos: IRelativePosition) {
		return this._mergeTree.posFromRelativePos(relativePos);
	}

	public getMarkerFromId(id: string): ISegment | undefined {
		return this._mergeTree.getMarkerFromId(id);
	}

	/**
	 * Revert an op
	 */
	public rollback?(op: any, localOpMetadata: unknown) {
		this._mergeTree.rollback(op as IMergeTreeDeltaOp, localOpMetadata as SegmentGroup);
	}

	/**
	 * Performs the remove based on the provided op
	 * @param opArgs - The ops args for the op
	 * @returns True if the remove was applied. False if it could not be.
	 */
	private applyRemoveRangeOp(opArgs: IMergeTreeDeltaOpArgs): boolean {
		assert(
			opArgs.op.type === MergeTreeDeltaType.REMOVE,
			0x02d /* "Unexpected op type on range remove!" */,
		);
		const op = opArgs.op;
		const clientArgs = this.getClientSequenceArgs(opArgs);
		const range = this.getValidOpRange(op, clientArgs);

		this._mergeTree.markRangeRemoved(
			range.start,
			range.end,
			clientArgs.referenceSequenceNumber,
			clientArgs.clientId,
			clientArgs.sequenceNumber,
			false,
			opArgs,
		);

		return true;
	}

	/**
	 * Performs the annotate based on the provided op
	 * @param opArgs - The ops args for the op
	 * @returns True if the annotate was applied. False if it could not be.
	 */
	private applyAnnotateRangeOp(opArgs: IMergeTreeDeltaOpArgs): boolean {
		assert(
			opArgs.op.type === MergeTreeDeltaType.ANNOTATE,
			0x02e /* "Unexpected op type on range annotate!" */,
		);
		const op = opArgs.op;
		const clientArgs = this.getClientSequenceArgs(opArgs);
		const range = this.getValidOpRange(op, clientArgs);

		if (!range) {
			return false;
		}

		this._mergeTree.annotateRange(
			range.start,
			range.end,
			op.props,
			op.combiningOp,
			clientArgs.referenceSequenceNumber,
			clientArgs.clientId,
			clientArgs.sequenceNumber,
			opArgs,
		);

		return true;
	}

	/**
	 * Performs the insert based on the provided op
	 * @param opArgs - The ops args for the op
	 * @returns True if the insert was applied. False if it could not be.
	 */
	private applyInsertOp(opArgs: IMergeTreeDeltaOpArgs): boolean {
		assert(
			opArgs.op.type === MergeTreeDeltaType.INSERT,
			0x02f /* "Unexpected op type on range insert!" */,
		);
		const op = opArgs.op;
		const clientArgs = this.getClientSequenceArgs(opArgs);
		const range = this.getValidOpRange(op, clientArgs);

		if (!range) {
			return false;
		}

		let segments: ISegment[] | undefined;
		if (op.seg) {
			segments = [this.specToSegment(op.seg)];
		}

		if (!segments || segments.length === 0) {
			return false;
		}

		this._mergeTree.insertSegments(
			range.start,
			segments,
			clientArgs.referenceSequenceNumber,
			clientArgs.clientId,
			clientArgs.sequenceNumber,
			opArgs,
		);
		return true;
	}

	/**
	 * Returns a valid range for the op, or undefined
	 * @param op - The op to generate the range for
	 * @param clientArgs - The client args for the op
	 */
	private getValidOpRange(
		op: IMergeTreeAnnotateMsg | IMergeTreeInsertMsg | IMergeTreeRemoveMsg,
		clientArgs: IMergeTreeClientSequenceArgs,
	): IIntegerRange {
		let start: number | undefined = op.pos1;
		if (start === undefined && op.relativePos1) {
			start = this._mergeTree.posFromRelativePos(
				op.relativePos1,
				clientArgs.referenceSequenceNumber,
				clientArgs.clientId,
			);
		}

		let end: number | undefined = op.pos2;
		if (end === undefined && op.relativePos2) {
			end = this._mergeTree.posFromRelativePos(
				op.relativePos2,
				clientArgs.referenceSequenceNumber,
				clientArgs.clientId,
			);
		}

		// Validate if local op
		if (clientArgs.clientId === this.getClientId()) {
			const length = this.getLength();

			const invalidPositions: string[] = [];

			// Validate start position
			//
			if (
				start === undefined ||
				start < 0 ||
				start > length ||
				(start === length && op.type !== MergeTreeDeltaType.INSERT)
			) {
				invalidPositions.push("start");
			}
			// Validate end if not insert, or insert has end
			//
			if (op.type !== MergeTreeDeltaType.INSERT || end !== undefined) {
				if (end === undefined || end <= start!) {
					invalidPositions.push("end");
				}
			}

			if (invalidPositions.length > 0) {
				throw new LoggingError("RangeOutOfBounds", {
					usageError: true,
					end,
					invalidPositions: invalidPositions.toString(),
					length,
					opPos1: op.pos1,
					opPos1Relative: op.relativePos1 !== undefined,
					opPos2: op.pos2,
					opPos2Relative: op.relativePos2 !== undefined,
					opType: op.type,
					start,
				});
			}
		}

		// start and end are guaranteed to be non-null here, otherwise we throw above.
		// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
		return { start, end } as IIntegerRange;
	}

	/**
	 * Gets the client args from the op if remote, otherwise uses the local clients info
	 * @param sequencedMessage - The sequencedMessage to get the client sequence args for
	 */
	private getClientSequenceArgsForMessage(
		sequencedMessage:
			| ISequencedDocumentMessage
			| Pick<ISequencedDocumentMessage, "referenceSequenceNumber" | "clientId">
			| undefined,
	) {
		// If there this no sequenced message, then the op is local
		// and unacked, so use this clients sequenced args
		//
		if (!sequencedMessage) {
			const segWindow = this.getCollabWindow();
			return {
				clientId: segWindow.clientId,
				referenceSequenceNumber: segWindow.currentSeq,
				sequenceNumber: this.getLocalSequenceNumber(),
			};
		} else {
			return {
				clientId: this.getOrAddShortClientIdFromMessage(sequencedMessage),
				referenceSequenceNumber: sequencedMessage.referenceSequenceNumber,
				// Note: return value satisfies overload signatures despite the cast, as if input argument doesn't contain sequenceNumber,
				// return value isn't expected to have it either.
				sequenceNumber: (sequencedMessage as ISequencedDocumentMessage).sequenceNumber,
			};
		}
	}

	/**
	 * Gets the client args from the op if remote, otherwise uses the local clients info
	 * @param opArgs - The op arg to get the client sequence args for
	 */
	private getClientSequenceArgs(opArgs: IMergeTreeDeltaOpArgs): IMergeTreeClientSequenceArgs {
		return this.getClientSequenceArgsForMessage(opArgs.sequencedMessage);
	}

	private ackPendingSegment(opArgs: IMergeTreeDeltaRemoteOpArgs) {
		const ackOp = (deltaOpArgs: IMergeTreeDeltaRemoteOpArgs) => {
			this._mergeTree.ackPendingSegment(deltaOpArgs);
			if (deltaOpArgs.op.type === MergeTreeDeltaType.ANNOTATE) {
				if (deltaOpArgs.op.combiningOp && deltaOpArgs.op.combiningOp.name === "consensus") {
					this.updateConsensusProperty(deltaOpArgs.op, deltaOpArgs.sequencedMessage);
				}
			}
		};

		if (opArgs.op.type === MergeTreeDeltaType.GROUP) {
			for (const memberOp of opArgs.op.ops) {
				ackOp({
					groupOp: opArgs.op,
					op: memberOp,
					sequencedMessage: opArgs.sequencedMessage,
				});
			}
		} else {
			ackOp(opArgs);
		}
	}

	// as functions are modified move them above the eslint-disabled waterline and lint them

	cloneFromSegments() {
		const clone = new Client(this.specToSegment, this.logger, this._mergeTree.options);
		const segments: ISegment[] = [];
		const newRoot = this._mergeTree.blockClone(this._mergeTree.root, segments);
		clone._mergeTree.root = newRoot;
		return clone;
	}
	getOrAddShortClientId(longClientId: string) {
		if (!this.clientNameToIds.get(longClientId)) {
			this.addLongClientId(longClientId);
		}
		return this.getShortClientId(longClientId);
	}

	getShortClientId(longClientId: string) {
		return this.clientNameToIds.get(longClientId)!.data;
	}
	getLongClientId(shortClientId: number) {
		return shortClientId >= 0 ? this.shortClientIdMap[shortClientId] : "original";
	}
	addLongClientId(longClientId: string) {
		this.clientNameToIds.put(longClientId, this.shortClientIdMap.length);
		this.shortClientIdMap.push(longClientId);
	}
	private getOrAddShortClientIdFromMessage(msg: Pick<ISequencedDocumentMessage, "clientId">) {
		return this.getOrAddShortClientId(msg.clientId ?? "server");
	}

	/**
	 * During reconnect, we must find the positions to pending segments
	 * relative to other pending segments. This methods computes that
	 * position relative to a localSeq. Pending segments above the localSeq
	 * will be ignored.
	 *
	 * @param segment - The segment to find the position for
	 * @param localSeq - The localSeq to find the position of the segment at
	 */
	public findReconnectionPosition(segment: ISegment, localSeq: number) {
		assert(
			localSeq <= this._mergeTree.collabWindow.localSeq,
			0x032 /* "localSeq greater than collab window" */,
		);
		const { currentSeq, clientId } = this.getCollabWindow();
		return this._mergeTree.getPosition(segment, currentSeq, clientId, localSeq);
	}

	private resetPendingDeltaToOps(
		resetOp: IMergeTreeDeltaOp,
		segmentGroup: SegmentGroup,
	): IMergeTreeDeltaOp[] {
		assert(!!segmentGroup, 0x033 /* "Segment group undefined" */);
		const NACKedSegmentGroup = this._mergeTree.pendingSegments.shift()?.data;
		assert(
			segmentGroup === NACKedSegmentGroup,
			0x034 /* "Segment group not at head of merge tree pending queue" */,
		);

		const opList: IMergeTreeDeltaOp[] = [];
		// We need to sort the segments by ordinal, as the segments are not sorted in the segment group.
		// The reason they need them sorted, as they have the same local sequence number and which means
		// farther segments will  take into account nearer segments when calculating their position.
		// By sorting we ensure the nearer segment will be applied and sequenced before the farther segments
		// so their recalculated positions will be correct.
		for (const segment of segmentGroup.segments.sort((a, b) =>
			a.ordinal < b.ordinal ? -1 : 1,
		)) {
			const segmentSegGroup = segment.segmentGroups.dequeue();
			assert(
				segmentGroup === segmentSegGroup,
				0x035 /* "Segment group not at head of segment pending queue" */,
			);
			const segmentPosition = this.findReconnectionPosition(segment, segmentGroup.localSeq);
			let newOp: IMergeTreeDeltaOp | undefined;
			switch (resetOp.type) {
				case MergeTreeDeltaType.ANNOTATE:
					assert(
						segment.propertyManager?.hasPendingProperties() === true,
						0x036 /* "Segment has no pending properties" */,
					);
					// if the segment has been removed, there's no need to send the annotate op
					// unless the remove was local, in which case the annotate must have come
					// before the remove
					if (
						segment.removedSeq === undefined ||
						(segment.localRemovedSeq !== undefined &&
							segment.removedSeq === UnassignedSequenceNumber)
					) {
						newOp = createAnnotateRangeOp(
							segmentPosition,
							segmentPosition + segment.cachedLength,
							resetOp.props,
							resetOp.combiningOp,
						);
					}
					break;

				case MergeTreeDeltaType.INSERT:
					assert(
						segment.seq === UnassignedSequenceNumber,
						0x037 /* "Segment already has assigned sequence number" */,
					);
					let segInsertOp = segment;
					if (typeof resetOp.seg === "object" && resetOp.seg.props !== undefined) {
						segInsertOp = segment.clone();
						segInsertOp.properties = resetOp.seg.props;
					}
					newOp = createInsertSegmentOp(segmentPosition, segInsertOp);
					break;

				case MergeTreeDeltaType.REMOVE:
					if (
						segment.localRemovedSeq !== undefined &&
						segment.removedSeq === UnassignedSequenceNumber
					) {
						newOp = createRemoveRangeOp(
							segmentPosition,
							segmentPosition + segment.cachedLength,
						);
					}
					break;

				default:
					throw new Error(`Invalid op type`);
			}

			if (newOp) {
				const newSegmentGroup: SegmentGroup = {
					segments: [],
					localSeq: segmentGroup.localSeq,
					refSeq: this.getCollabWindow().currentSeq,
				};
				segment.segmentGroups.enqueue(newSegmentGroup);
				this._mergeTree.pendingSegments.push(newSegmentGroup);
				opList.push(newOp);
			}
		}

		return opList;
	}

	private applyRemoteOp(opArgs: IMergeTreeDeltaRemoteOpArgs) {
		const op = opArgs.op;
		const msg = opArgs.sequencedMessage;
		this.getOrAddShortClientIdFromMessage(msg);
		switch (op.type) {
			case MergeTreeDeltaType.INSERT:
				this.applyInsertOp(opArgs);
				break;
			case MergeTreeDeltaType.REMOVE:
				this.applyRemoveRangeOp(opArgs);
				break;
			case MergeTreeDeltaType.ANNOTATE:
				this.applyAnnotateRangeOp(opArgs);
				break;
			case MergeTreeDeltaType.GROUP: {
				for (const memberOp of op.ops) {
					this.applyRemoteOp({
						op: memberOp,
						groupOp: op,
						sequencedMessage: msg,
					});
				}
				break;
			}
			default:
				break;
		}
	}

	public applyStashedOp(op: IMergeTreeDeltaOp): SegmentGroup;
	public applyStashedOp(op: IMergeTreeGroupMsg): SegmentGroup[];
	public applyStashedOp(op: IMergeTreeOp): SegmentGroup | SegmentGroup[];
	public applyStashedOp(op: IMergeTreeOp): SegmentGroup | SegmentGroup[] {
		let metadata: SegmentGroup | SegmentGroup[] | undefined;
		switch (op.type) {
			case MergeTreeDeltaType.INSERT:
				this.applyInsertOp({ op });
				metadata = this.peekPendingSegmentGroups();
				break;
			case MergeTreeDeltaType.REMOVE:
				this.applyRemoveRangeOp({ op });
				metadata = this.peekPendingSegmentGroups();
				break;
			case MergeTreeDeltaType.ANNOTATE:
				this.applyAnnotateRangeOp({ op });
				metadata = this.peekPendingSegmentGroups();
				break;
			case MergeTreeDeltaType.GROUP:
				return op.ops.map((o) => this.applyStashedOp(o));
			default:
				unreachableCase(op, "unrecognized op type");
		}
		assert(!!metadata, 0x2db /* "Applying op must generate a pending segment" */);
		return metadata;
	}

	public applyMsg(msg: ISequencedDocumentMessage, local: boolean = false) {
		// Ensure client ID is registered
		this.getOrAddShortClientIdFromMessage(msg);
		// Apply if an operation message
		if (msg.type === MessageType.Operation) {
			const opArgs: IMergeTreeDeltaRemoteOpArgs = {
				op: msg.contents as IMergeTreeOp,
				sequencedMessage: msg,
			};
			if (opArgs.sequencedMessage?.clientId === this.longClientId || local) {
				this.ackPendingSegment(opArgs);
			} else {
				this.applyRemoteOp(opArgs);
			}
		}

		this.updateSeqNumbers(msg.minimumSequenceNumber, msg.sequenceNumber);
	}

	public updateSeqNumbers(min: number, seq: number) {
		const collabWindow = this.getCollabWindow();
		// Equal is fine here due to SharedSegmentSequence<>.snapshotContent() potentially updating with same #
		assert(
			collabWindow.currentSeq <= seq,
			0x038 /* "Incoming op sequence# < local collabWindow's currentSequence#" */,
		);
		collabWindow.currentSeq = seq;
		assert(min <= seq, 0x039 /* "Incoming op sequence# < minSequence#" */);
		this.updateMinSeq(min);
	}

	/**
	 * Resolves a remote client's position against the local sequence
	 * and returns the remote client's position relative to the local
	 * sequence
	 * @param remoteClientPosition - The remote client's position to resolve
	 * @param remoteClientRefSeq - The reference sequence number of the remote client
	 * @param remoteClientId - The client id of the remote client
	 */
	public resolveRemoteClientPosition(
		remoteClientPosition: number,
		remoteClientRefSeq: number,
		remoteClientId: string,
	): number | undefined {
		const shortRemoteClientId = this.getOrAddShortClientId(remoteClientId);
		return this._mergeTree.resolveRemoteClientPosition(
			remoteClientPosition,
			remoteClientRefSeq,
			shortRemoteClientId,
		);
	}

	private lastNormalizationRefSeq = 0;
	/**
	 * Given an pending operation and segment group, regenerate the op, so it
	 * can be resubmitted
	 * @param resetOp - The op to reset
	 * @param segmentGroup - The segment group associated with the op
	 */
	public regeneratePendingOp(
		resetOp: IMergeTreeOp,
		segmentGroup: SegmentGroup | SegmentGroup[],
	): IMergeTreeOp {
		const rebaseTo = this.getCollabWindow().currentSeq;
		if (rebaseTo !== this.lastNormalizationRefSeq) {
			this.emit("normalize", this);
			this._mergeTree.normalizeSegmentsOnRebase();
			this.lastNormalizationRefSeq = rebaseTo;
		}

		const opList: IMergeTreeDeltaOp[] = [];
		if (resetOp.type === MergeTreeDeltaType.GROUP) {
			if (Array.isArray(segmentGroup)) {
				assert(
					resetOp.ops.length === segmentGroup.length,
					0x03a /* "Number of ops in 'resetOp' must match the number of segment groups provided." */,
				);

				for (let i = 0; i < resetOp.ops.length; i++) {
					opList.push(...this.resetPendingDeltaToOps(resetOp.ops[i], segmentGroup[i]));
				}
			} else {
				// A group op containing a single op will pass a direct reference to 'segmentGroup'
				// rather than an array of segment groups.  (See 'peekPendingSegmentGroups()')
				assert(
					resetOp.ops.length === 1,
					0x03b /* "Number of ops in 'resetOp' must match the number of segment groups provided." */,
				);
				opList.push(...this.resetPendingDeltaToOps(resetOp.ops[0], segmentGroup));
			}
		} else {
			assert(
				(resetOp.type as any) !== MergeTreeDeltaType.GROUP,
				0x03c /* "Reset op has 'group' delta type!" */,
			);
			assert(
				!Array.isArray(segmentGroup),
				0x03d /* "segmentGroup is array rather than singleton!" */,
			);
			opList.push(...this.resetPendingDeltaToOps(resetOp, segmentGroup));
		}
		return opList.length === 1 ? opList[0] : createGroupOp(...opList);
	}

	public createTextHelper(): IMergeTreeTextHelper {
		return new MergeTreeTextHelper(this._mergeTree);
	}

	public summarize(
		runtime: IFluidDataStoreRuntime,
		handle: IFluidHandle,
		serializer: IFluidSerializer,
		catchUpMsgs: ISequencedDocumentMessage[],
	): ISummaryTreeWithStats {
		const deltaManager = runtime.deltaManager;
		const minSeq = deltaManager.minimumSequenceNumber;

		// Catch up to latest MSN, if we have not had a chance to do it.
		// Required for case where FluidDataStoreRuntime.attachChannel()
		// generates summary right after loading data store.

		this.updateSeqNumbers(minSeq, deltaManager.lastSequenceNumber);

		// One of the summaries (from SPO) I observed to have chunk.chunkSequenceNumber > minSeq!
		// Not sure why - need to catch it sooner
		assert(
			this.getCollabWindow().minSeq === minSeq,
			0x03e /* "minSeq mismatch between collab window and delta manager!" */,
		);

		// Must continue to support legacy
		//       (See https://github.com/microsoft/FluidFramework/issues/84)
		if (this._mergeTree.options?.newMergeTreeSnapshotFormat === true) {
			assert(
				catchUpMsgs === undefined || catchUpMsgs.length === 0,
				0x03f /* "New format should not emit catchup ops" */,
			);
			const snap = new SnapshotV1(this._mergeTree, this.logger, (id) =>
				this.getLongClientId(id),
			);
			snap.extractSync();
			return snap.emit(serializer, handle);
		} else {
			const snap = new SnapshotLegacy(this._mergeTree, this.logger);
			snap.extractSync();
			return snap.emit(catchUpMsgs, serializer, handle);
		}
	}

	public async load(
		runtime: IFluidDataStoreRuntime,
		storage: IChannelStorageService,
		serializer: IFluidSerializer,
	): Promise<{ catchupOpsP: Promise<ISequencedDocumentMessage[]> }> {
		const loader = new SnapshotLoader(runtime, this, this._mergeTree, this.logger, serializer);

		return loader.initialize(storage);
	}

	getStackContext(startPos: number, rangeLabels: string[]): RangeStackMap {
		return this._mergeTree.getStackContext(
			startPos,
			this.getCollabWindow().clientId,
			rangeLabels,
		);
	}

	private getLocalSequenceNumber() {
		const segWindow = this.getCollabWindow();
		return segWindow.collaborating ? UnassignedSequenceNumber : UniversalSequenceNumber;
	}
	localTransaction(groupOp: IMergeTreeGroupMsg) {
		for (const op of groupOp.ops) {
			const opArgs: IMergeTreeDeltaOpArgs = {
				op,
				groupOp,
			};
			switch (op.type) {
				case MergeTreeDeltaType.INSERT:
					this.applyInsertOp(opArgs);
					break;
				case MergeTreeDeltaType.ANNOTATE:
					this.applyAnnotateRangeOp(opArgs);
					break;
				case MergeTreeDeltaType.REMOVE:
					this.applyRemoveRangeOp(opArgs);
					break;
				default:
					break;
			}
		}
	}
	updateConsensusProperty(op: IMergeTreeAnnotateMsg, msg: ISequencedDocumentMessage) {
		const markerId = op.relativePos1!.id!;
		const consensusInfo = this.pendingConsensus.get(markerId);
		if (consensusInfo) {
			consensusInfo.marker.addProperties(op.props, op.combiningOp, msg.sequenceNumber);
		}
		this._mergeTree.addMinSeqListener(msg.sequenceNumber, () =>
			consensusInfo!.callback(consensusInfo!.marker),
		);
	}

	updateMinSeq(minSeq: number) {
		this._mergeTree.setMinSeq(minSeq);
	}

	getContainingSegment<T extends ISegment>(
		pos: number,
		sequenceArgs?: Pick<ISequencedDocumentMessage, "referenceSequenceNumber" | "clientId">,
		localSeq?: number,
	) {
		const { referenceSequenceNumber, clientId } =
			this.getClientSequenceArgsForMessage(sequenceArgs);
		return this._mergeTree.getContainingSegment<T>(
			pos,
			referenceSequenceNumber,
			clientId,
			localSeq,
		);
	}

	/**
	 * Returns the position to slide a reference to if a slide is required.
	 * @param segoff - The segment and offset to slide from
	 * @returns - segment and offset to slide the reference to
	 */
	getSlideToSegment(segoff: { segment: ISegment | undefined; offset: number | undefined }) {
		if (segoff.segment === undefined) {
			return segoff;
		}
		const segment = this._mergeTree._getSlideToSegment(segoff.segment);
		if (segment === segoff.segment) {
			return segoff;
		}
		const offset =
			segment && segment.ordinal < segoff.segment.ordinal ? segment.cachedLength - 1 : 0;
		return {
			segment,
			offset,
		};
	}

	getPropertiesAtPosition(pos: number) {
		let propertiesAtPosition: PropertySet | undefined;
		const segoff = this.getContainingSegment(pos);
		const seg = segoff.segment;
		if (seg) {
			propertiesAtPosition = seg.properties;
		}
		return propertiesAtPosition;
	}
	getRangeExtentsOfPosition(pos: number) {
		let posStart: number | undefined;
		let posAfterEnd: number | undefined;

		const segoff = this.getContainingSegment(pos);
		const seg = segoff.segment;
		if (seg) {
			posStart = this.getPosition(seg);
			posAfterEnd = posStart + seg.cachedLength;
		}
		return { posStart, posAfterEnd };
	}
	getCurrentSeq() {
		return this.getCollabWindow().currentSeq;
	}
	getClientId() {
		return this.getCollabWindow().clientId;
	}

	getLength() {
		return this._mergeTree.length;
	}

	startOrUpdateCollaboration(longClientId: string | undefined, minSeq = 0, currentSeq = 0) {
		// we should always have a client id if we are collaborating
		// if the client id is undefined we are likely bound to a detached
		// container, so we should keep going in local mode. once
		// the container attaches this will be called again on connect with the
		// client id
		if (longClientId !== undefined) {
			if (this.longClientId === undefined) {
				this.longClientId = longClientId;
				this.addLongClientId(this.longClientId);
				this._mergeTree.startCollaboration(
					this.getShortClientId(this.longClientId),
					minSeq,
					currentSeq,
				);
			} else {
				const oldClientId = this.longClientId;
				const oldData = this.clientNameToIds.get(oldClientId)!.data;
				this.longClientId = longClientId;
				this.clientNameToIds.put(longClientId, oldData);
				this.shortClientIdMap[oldData] = longClientId;
			}
		}
	}

	findTile(startPos: number, tileLabel: string, preceding = true) {
		const clientId = this.getClientId();
		return this._mergeTree.findTile(startPos, clientId, tileLabel, preceding);
	}
}
