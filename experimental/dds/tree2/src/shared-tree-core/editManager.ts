/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import BTree from "sorted-btree";
import { assert } from "@fluidframework/common-utils";
import {
	brand,
	Brand,
	fail,
	getOrCreate,
	mapIterable,
	Mutable,
	RecursiveReadonly,
	zipIterables,
} from "../util";
import {
	AnchorSet,
	assertIsRevisionTag,
	ChangeFamily,
	ChangeFamilyEditor,
	findAncestor,
	findCommonAncestor,
	GraphCommit,
	IRepairDataStoreProvider,
	mintCommit,
	rebaseBranch,
	rebaseChange,
	RevisionTag,
	SessionId,
	SimpleDependee,
	UndoRedoManager,
} from "../core";
import { createEmitter, ISubscribable } from "../events";
import { SharedTreeBranch } from "./branch";

export type SeqNumber = Brand<number, "edit-manager.SeqNumber">;
/**
 * Contains a single change to the `SharedTree` and associated metadata
 */
export interface Commit<TChangeset> extends Omit<GraphCommit<TChangeset>, "parent"> {
	/** An identifier representing the session/user/client that made this commit */
	readonly sessionId: SessionId;
}
/**
 * A commit with a sequence number but no parentage; used for serializing the `EditManager` into a summary
 */
export interface SequencedCommit<TChangeset> extends Commit<TChangeset> {
	sequenceNumber: SeqNumber;
}
/**
 * A commit in the commit graph that has been sequenced with a sequence number; these make up the trunk
 */
interface TrunkCommit<TChangeset> extends SequencedCommit<TChangeset> {
	parent?: TrunkCommit<TChangeset>;
}

export const minimumPossibleSequenceNumber: SeqNumber = brand(Number.MIN_SAFE_INTEGER);
const nullRevisionTag = assertIsRevisionTag("00000000-0000-4000-8000-000000000000");

export interface EditManagerEvents<TChangeset> {
	/**
	 * Fired every time that a new commit is added to the trunk
	 * @param newHead - the new head of the trunk
	 */
	newTrunkHead(newHead: GraphCommit<TChangeset>): void;
}

/**
 * Represents a local branch of a document and interprets the effect on the document of adding sequenced changes,
 * which were based on a given session's branch, to the document history
 */
// TODO: Try to reduce this to a single type parameter
export class EditManager<
		TEditor extends ChangeFamilyEditor,
		TChangeset,
		TChangeFamily extends ChangeFamily<TEditor, TChangeset>,
	>
	extends SimpleDependee
	implements ISubscribable<EditManagerEvents<TChangeset>>
{
	/**
	 * The head commit of the "trunk" branch. The trunk represents the list of received sequenced changes.
	 */
	private trunk: TrunkCommit<TChangeset>;

	/**
	 * The {@link UndoRedoManager} associated with the trunk.
	 */
	private readonly trunkUndoRedoManager: UndoRedoManager<TChangeset, TEditor>;

	/**
	 * Branches are maintained to represent the local change list that the issuing client had
	 * at the time of submitting the latest known edit on the branch.
	 * This means the head commit of each branch is always in its original (non-rebased) form.
	 */
	private readonly peerLocalBranches: Map<SessionId, GraphCommit<TChangeset>> = new Map();

	/**
	 * This branch holds the changes made by this client which have not yet been confirmed as sequenced changes.
	 */
	public readonly localBranch: SharedTreeBranch<TEditor, TChangeset>;

	/**
	 * The {@link UndoRedoManager} associated with the local branch.
	 */
	private readonly localBranchUndoRedoManager: UndoRedoManager<TChangeset, TEditor>;

	/**
	 * Tracks where on the trunk all registered branches are based. Each key is the sequence number of a commit on
	 * the trunk, and the value is the set of all branches who have that commit as their common ancestor with the trunk.
	 */
	private readonly trunkBranches = new BTree<
		SeqNumber,
		Set<SharedTreeBranch<TEditor, TChangeset>>
	>();

	/**
	 * The sequence number of the newest commit on the trunk that has been received by all peers
	 */
	private minimumSequenceNumber: SeqNumber = brand(-1);

	/**
	 * A map from a sequence number to the commit in the trunk which has that sequence number
	 */
	private readonly sequenceMap = new BTree<SeqNumber, TrunkCommit<TChangeset>>();

	/**
	 * An immutable "origin" commit singleton on which the trunk is based.
	 * This makes it possible to model the trunk in the same way as any other branch
	 * (it branches off of a base commit) which simplifies some logic.
	 */
	private readonly trunkBase: TrunkCommit<TChangeset>;

	private readonly events = createEmitter<EditManagerEvents<TChangeset>>();

	public on<K extends keyof EditManagerEvents<TChangeset>>(
		eventName: K,
		listener: EditManagerEvents<TChangeset>[K],
	): () => void {
		return this.events.on(eventName, listener);
	}

	/**
	 *
	 * @param changeFamily - the change family of changes on the trunk and local branch
	 * @param localSessionId - the id of the local session that will be used for local commits
	 * @param repairDataStoreProvider - used for undoing/redoing the local branch
	 * @param anchors - an optional set of anchors to be rebased by the local branch when it changes
	 */
	public constructor(
		public readonly changeFamily: TChangeFamily,
		// TODO: Change this type to be the Session ID type provided by the IdCompressor when available.
		public readonly localSessionId: SessionId,
		repairDataStoreProvider: IRepairDataStoreProvider,
		anchors?: AnchorSet,
	) {
		super("EditManager");
		this.trunkBase = {
			revision: nullRevisionTag,
			sessionId: "",
			change: changeFamily.rebaser.compose([]),
			sequenceNumber: minimumPossibleSequenceNumber,
		};
		this.trunk = this.trunkBase;
		this.localBranchUndoRedoManager = UndoRedoManager.create(
			repairDataStoreProvider,
			changeFamily,
		);
		this.trunkUndoRedoManager = this.localBranchUndoRedoManager.clone();
		this.localBranch = new SharedTreeBranch(
			this.trunk,
			changeFamily,
			this.localBranchUndoRedoManager,
			anchors,
		);
		// This registers each fork of the local branch, rather than registering the local branch directly.
		// Registering the local branch _almost_ works the same, except that it means the trunk retains an
		// additional commit - because the local branch is always rebased off of the trunk's head, we can
		// never evict the head. That sounds like a good thing, but because the trunk has a privileged
		// relationship with the local branch (the local branch doesn't undergo normal rebasing), we can
		// actually safely evict that last commit (assuming there are no other outstanding branches).
		// TODO: Fiddle with the local case of addSequencedChange some more, and see if you can make it actually do a rebase.
		this.localBranch.on("fork", (fork) => this.registerBranch(fork));
	}

	/**
	 * Make the given branch known to the `EditManager`. The `EditManager` will ensure that all registered
	 * branches remain usable even as the minimum sequence number advances.
	 * @param branch - the branch to register. All branches that fork from this branch, directly or transitively,
	 * will also be registered.
	 */
	private registerBranch(branch: SharedTreeBranch<TEditor, TChangeset>): void {
		const trackBranch = (b: SharedTreeBranch<TEditor, TChangeset>): SeqNumber => {
			const trunkCommit = findCommonAncestor(this.trunk, b.getHead());
			assert(
				isTrunkCommit(trunkCommit),
				0x66f /* Expected commit to be on the trunk branch */,
			);
			const branches = getOrCreate(
				this.trunkBranches,
				trunkCommit.sequenceNumber,
				() => new Set(),
			);

			assert(!branches.has(b), 0x670 /* Branch was registered more than once */);
			branches.add(b);
			return trunkCommit.sequenceNumber;
		};

		const untrackBranch = (
			b: SharedTreeBranch<TEditor, TChangeset>,
			sequenceNumber: SeqNumber,
		): void => {
			const branches =
				this.trunkBranches.get(sequenceNumber) ?? fail("Expected branch to be tracked");

			assert(branches.delete(b), 0x671 /* Expected branch to be tracked */);
			if (branches.size === 0) {
				this.trunkBranches.delete(sequenceNumber);
			}
		};

		// Record the sequence number of the branch's base commit on the trunk
		const trunkBase = { sequenceNumber: trackBranch(branch) };
		// Whenever the branch forks, register the new fork
		const offFork = branch.on("fork", (f) => this.registerBranch(f));
		// Whenever the branch is rebased, update our record of its base trunk commit
		const offRebase = branch.on("change", ({ type }) => {
			if (type === "rebase") {
				untrackBranch(branch, trunkBase.sequenceNumber);
				trunkBase.sequenceNumber = trackBranch(branch);
			}
		});
		// When the branch is disposed, update our branch set and trim the trunk
		const offDispose = branch.on("dispose", () => {
			untrackBranch(branch, trunkBase.sequenceNumber);
			this.trimTrunk();
			offFork();
			offRebase();
			offDispose();
		});
	}

	/**
	 * Advances the minimum sequence number, and removes all commits from the trunk which lie outside the collaboration window.
	 * @param minimumSequenceNumber - the sequence number of the newest commit that all peers (including this one) have received and applied to their trunks
	 */
	public advanceMinimumSequenceNumber(minimumSequenceNumber: SeqNumber): void {
		if (minimumSequenceNumber === this.minimumSequenceNumber) {
			return;
		}

		assert(
			minimumSequenceNumber > this.minimumSequenceNumber,
			0x476 /* number must be larger or equal to current minimumSequenceNumber. */,
		);

		this.minimumSequenceNumber = minimumSequenceNumber;
		this.trimTrunk();
	}

	/**
	 * Examines the latest known minimum sequence number and the trunk bases of any registered branches to determine
	 * if any commits on the trunk are unreferenced and unneeded for future computation; those found are evicted from the trunk.
	 * @returns the number of commits that were removed from the trunk
	 */
	private trimTrunk(): number {
		let deleted = 0;
		/** The sequence number of the oldest commit on the trunk that will be retained */
		let trunkTailSearchKey = this.minimumSequenceNumber;
		// If there are any outstanding registered branches, get the one that is the oldest (has the "most behind" trunk base)
		const minimumBranchBaseSequenceNumber = this.trunkBranches.minKey();
		if (minimumBranchBaseSequenceNumber !== undefined) {
			// If that branch is behind the minimum sequence number, we only want to evict commits older than it,
			// even if those commits are behind the minimum sequence number
			trunkTailSearchKey = brand(
				Math.min(trunkTailSearchKey, minimumBranchBaseSequenceNumber),
			);
		}

		// The new tail of the trunk is the commit at or just past the new minimum trunk sequence number
		const searchResult = this.sequenceMap.getPairOrNextHigher(trunkTailSearchKey);
		if (searchResult !== undefined) {
			const [_, newTrunkTail] = searchResult;
			// Don't do any work if the commit found by the search is already the tail of the trunk
			if (newTrunkTail.parent !== this.trunkBase) {
				// This is dangerous. Commits ought to be immutable, but if they are then changing the trunk tail requires
				// regenerating the entire commit graph. It is, in general, safe to chop off the tail like this if we know
				// that there are no outstanding references to any of the commits being removed. For example, there must be
				// no existing branches that are based off of any of the commits being removed.
				(newTrunkTail as Mutable<TrunkCommit<TChangeset>>).parent = this.trunkBase;

				this.sequenceMap.forRange(
					minimumPossibleSequenceNumber,
					newTrunkTail.sequenceNumber,
					false,
					(_seq, { revision }) => {
						this.localBranchUndoRedoManager.untrackCommitType(revision);
					},
				);

				deleted = this.sequenceMap.deleteRange(
					minimumPossibleSequenceNumber,
					newTrunkTail.sequenceNumber,
					false,
				);

				for (const [sessionId, branch] of this.peerLocalBranches) {
					// If a session branch falls behind the min sequence number, then we know that its session has been abandoned by Fluid
					// (because otherwise, it would have already been updated) and we expect not to receive any more updates for it.
					if (findCommonAncestor(branch, newTrunkTail) === undefined) {
						this.peerLocalBranches.delete(sessionId);
					}
				}
			}
		} else {
			// If no trunk commit is found, it means that all trunk commits are below the search key, so evict them all
			assert(
				this.trunkBranches.isEmpty,
				0x672 /* Expected no registered branches when clearing trunk */,
			);
			this.trunk = this.trunkBase;
			this.sequenceMap.clear();
			this.peerLocalBranches.clear();
		}

		return deleted;
	}

	public isEmpty(): boolean {
		return (
			this.trunk === this.trunkBase &&
			this.peerLocalBranches.size === 0 &&
			this.localBranch.getHead() === this.trunk &&
			this.minimumSequenceNumber === -1
		);
	}

	public getSummaryData(): SummaryData<TChangeset> {
		// The assert below is acceptable at present because summarization only ever occurs on a client with no
		// local/in-flight changes.
		// In the future we may wish to relax this constraint. For that to work, the current implementation of
		// `EditManager` would have to be amended in one of two ways:
		// A) Changes made by the local session should be represented by a branch in `EditManager.branches`.
		// B) The contents of such a branch should be computed on demand based on the trunk.
		// Note that option (A) would be a simple change to `addSequencedChange` whereas (B) would likely require
		// rebasing trunk changes over the inverse of trunk changes.
		assert(
			this.localBranch.getHead() === this.trunk,
			0x428 /* Clients with local changes cannot be used to generate summaries */,
		);

		const trunkPath = getPathFromBase(this.trunk, this.trunkBase);
		assert(
			this.sequenceMap.size === trunkPath.length,
			0x572 /* Expected sequence map to be the same size as the trunk */,
		);
		const trunk = Array.from(
			mapIterable(
				zipIterables(this.sequenceMap.keys(), trunkPath),
				([sequenceNumber, commit]) => ({ ...commit, sequenceNumber }),
			),
		);

		const branches = new Map<SessionId, SummarySessionBranch<TChangeset>>(
			mapIterable(this.peerLocalBranches.entries(), ([sessionId, branch]) => {
				const branchPath: GraphCommit<TChangeset>[] = [];
				const ancestor =
					findCommonAncestor([branch, branchPath], this.trunk) ??
					fail("Expected branch to be based on trunk");

				return [
					sessionId,
					{
						base: ancestor.revision,
						commits: branchPath.map((c) => ({ ...c, sessionId })),
					},
				];
			}),
		);

		return { trunk, branches };
	}

	public loadSummaryData(data: SummaryData<TChangeset>): void {
		assert(
			this.isEmpty(),
			"Attempted to load from summary after edit manager was already mutated",
		);
		this.sequenceMap.clear();
		this.trunk = data.trunk.reduce((base, c) => {
			const commit = mintTrunkCommit(base, c);
			this.trunkUndoRedoManager.repairDataStoreProvider.applyDelta(
				this.changeFamily.intoDelta(commit.change),
			);
			this.sequenceMap.set(c.sequenceNumber, commit);
			return commit;
		}, this.trunkBase);

		this.localBranch.setHead(this.trunk);

		for (const [sessionId, branch] of data.branches) {
			const commit: GraphCommit<TChangeset> =
				findAncestor(this.trunk, (r) => r.revision === branch.base) ??
				fail("Expected summary branch to be based off of a revision in the trunk");

			this.peerLocalBranches.set(sessionId, branch.commits.reduce(mintCommit, commit));
		}
	}

	public getTrunk(): readonly RecursiveReadonly<Commit<TChangeset>>[] {
		return getPathFromBase(this.trunk, this.trunkBase);
	}

	public getTrunkHead(): GraphCommit<TChangeset> {
		return this.trunk;
	}

	public getLocalChanges(): readonly RecursiveReadonly<TChangeset>[] {
		return getPathFromBase(this.localBranch.getHead(), this.trunk).map((c) => c.change);
	}

	public addSequencedChange(
		newCommit: Commit<TChangeset>,
		sequenceNumber: SeqNumber,
		referenceSequenceNumber: SeqNumber,
	): void {
		if (newCommit.sessionId === this.localSessionId) {
			// `newCommit` should correspond to the oldest change in `localChanges`, so we move it into trunk.
			// `localChanges` are already rebased to the trunk, so we can use the stored change instead of rebasing the
			// change in the incoming commit.
			const localPath = getPathFromBase(this.localBranch.getHead(), this.trunk);
			// Get the first revision in the local branch, and then remove it
			const { change } =
				localPath.shift() ??
				fail(
					"Received a sequenced change from the local session despite having no local changes",
				);
			this.pushToTrunk(sequenceNumber, { ...newCommit, change }, true);

			{
				// TODO: Replace the line below with this line when UndoRedoManager is better optimized.
				// this.localBranch.rebaseOnto(this.trunk, this.trunkUndoRedoManager);
				this.localBranch.setHead(localPath.reduce(mintCommit, this.trunk));
			}

			return;
		}

		// Get the revision that the remote change is based on
		const baseRevisionInTrunk =
			this.sequenceMap.getPairOrNextLower(referenceSequenceNumber)?.[1] ?? this.trunkBase;

		// Rebase that branch over the part of the trunk up to the base revision
		// This will be a no-op if the sending client has not advanced since the last time we received an edit from it
		const [rebasedBranch] = rebaseBranch(
			this.changeFamily.rebaser,
			getOrCreate(this.peerLocalBranches, newCommit.sessionId, () => baseRevisionInTrunk),
			baseRevisionInTrunk,
			this.trunk,
		);

		if (rebasedBranch === this.trunk) {
			// If the branch is fully caught up and empty after being rebased, then push to the trunk directly
			this.pushToTrunk(sequenceNumber, newCommit);
			this.peerLocalBranches.set(newCommit.sessionId, this.trunk);
		} else {
			const newChangeFullyRebased = rebaseChange(
				this.changeFamily.rebaser,
				newCommit.change,
				rebasedBranch,
				this.trunk,
			);

			this.peerLocalBranches.set(newCommit.sessionId, mintCommit(rebasedBranch, newCommit));

			this.pushToTrunk(sequenceNumber, {
				...newCommit,
				change: newChangeFullyRebased,
			});
		}

		// Constructing this short-lived SharedTreeBranch for the trunk allows the local branch
		// to rebase onto it. TODO: Investigate if `this.trunk` can be a SharedTreeBranch.
		const trunkBranch = new SharedTreeBranch(
			this.trunk,
			this.changeFamily,
			this.trunkUndoRedoManager,
		);
		this.localBranch.rebaseOnto(trunkBranch);
	}

	public findLocalCommit(
		revision: RevisionTag,
	): [commit: GraphCommit<TChangeset>, commitsAfter: GraphCommit<TChangeset>[]] {
		const commits: GraphCommit<TChangeset>[] = [];
		const commit = findAncestor(
			[this.localBranch.getHead(), commits],
			(c) => c.revision === revision,
		);
		assert(commit !== undefined, 0x599 /* Expected local branch to contain revision */);
		return [commit, commits];
	}

	private pushToTrunk(
		sequenceNumber: SeqNumber,
		commit: Commit<TChangeset>,
		local = false,
	): void {
		this.trunk = mintTrunkCommit(this.trunk, commit, sequenceNumber);
		if (local) {
			const type =
				this.localBranchUndoRedoManager.getCommitType(this.trunk.revision) ??
				fail("Local commit types must be tracked until they are sequenced.");

			this.trunkUndoRedoManager.trackCommit(this.trunk, type);
		}
		this.trunkUndoRedoManager.repairDataStoreProvider.applyDelta(
			this.changeFamily.intoDelta(commit.change),
		);
		this.sequenceMap.set(sequenceNumber, this.trunk);
		this.events.emit("newTrunkHead", this.trunk);
	}
}

/**
 * A branch off of the trunk for use in summaries
 */
export interface SummarySessionBranch<TChangeset> {
	readonly base: RevisionTag;
	readonly commits: Commit<TChangeset>[];
}

/**
 * The in-memory data that summaries contain
 */
export interface SummaryData<TChangeset> {
	readonly trunk: readonly SequencedCommit<TChangeset>[];
	readonly branches: ReadonlyMap<SessionId, SummarySessionBranch<TChangeset>>;
}

/**
 * @returns the path from the base of a branch to its head
 */
function getPathFromBase<TCommit extends { parent?: TCommit }>(
	branchHead: TCommit,
	baseBranchHead: TCommit,
): TCommit[] {
	const path: TCommit[] = [];
	assert(
		findCommonAncestor([branchHead, path], baseBranchHead) !== undefined,
		0x573 /* Expected branches to be related */,
	);
	return path;
}

function isTrunkCommit<TChange>(commit?: GraphCommit<TChange>): commit is TrunkCommit<TChange> {
	return commit !== undefined && (commit as TrunkCommit<TChange>).sequenceNumber !== undefined;
}

function mintTrunkCommit<TChange>(
	parent: TrunkCommit<TChange>,
	commit: Commit<TChange>,
	sequenceNumber: SeqNumber,
): TrunkCommit<TChange>;
function mintTrunkCommit<TChange>(
	parent: TrunkCommit<TChange>,
	commit: SequencedCommit<TChange>,
): TrunkCommit<TChange>;
function mintTrunkCommit<TChange>(
	parent: TrunkCommit<TChange>,
	commit: Commit<TChange>,
	explicitSequenceNumber?: SeqNumber,
): TrunkCommit<TChange> {
	const sequenceNumber =
		explicitSequenceNumber ?? (commit as SequencedCommit<TChange>).sequenceNumber;

	return {
		revision: commit.revision,
		sessionId: commit.sessionId,
		change: commit.change,
		sequenceNumber,
		parent,
	};
}
