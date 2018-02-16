import * as resources from "gitresources";
import * as api from "../api-core";
import { SharedString } from "./sharedString";

export class CollaboritiveStringExtension implements api.IExtension {
    public static Type = "https://graph.microsoft.com/types/mergeTree";

    public type: string = CollaboritiveStringExtension.Type;

    public async load(
        document: api.IDocument,
        id: string,
        sequenceNumber: number,
        services: api.IDistributedObjectServices,
        version: resources.ICommit,
        headerOrigin: string): Promise<api.ICollaborativeObject> {

        let collaborativeString = new SharedString(document, id, sequenceNumber, services);
        await collaborativeString.load(sequenceNumber, version, headerOrigin, services);
        return collaborativeString;
    }

    public create(document: api.IDocument, id: string, options?: Object): api.ICollaborativeObject {
        let collaborativeString = new SharedString(document, id, 0);
        collaborativeString.initializeLocal();
        return collaborativeString;
    }
}
