/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */
/*
 * THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.
 * Generated by fluid-type-test-generator in @fluidframework/build-tools.
 */
import * as old from "@fluidframework/file-driver-previous";
import * as current from "../../index";

type TypeOnly<T> = {
    [P in keyof T]: TypeOnly<T[P]>;
};

/*
* Validate forward compat by using old type in place of current type
* If breaking change required, add in package.json under typeValidation.broken:
* "ClassDeclaration_FileDeltaStorageService": {"forwardCompat": false}
*/
declare function get_old_ClassDeclaration_FileDeltaStorageService():
    TypeOnly<old.FileDeltaStorageService>;
declare function use_current_ClassDeclaration_FileDeltaStorageService(
    use: TypeOnly<current.FileDeltaStorageService>);
use_current_ClassDeclaration_FileDeltaStorageService(
    get_old_ClassDeclaration_FileDeltaStorageService());

/*
* Validate back compat by using current type in place of old type
* If breaking change required, add in package.json under typeValidation.broken:
* "ClassDeclaration_FileDeltaStorageService": {"backCompat": false}
*/
declare function get_current_ClassDeclaration_FileDeltaStorageService():
    TypeOnly<current.FileDeltaStorageService>;
declare function use_old_ClassDeclaration_FileDeltaStorageService(
    use: TypeOnly<old.FileDeltaStorageService>);
use_old_ClassDeclaration_FileDeltaStorageService(
    get_current_ClassDeclaration_FileDeltaStorageService());

/*
* Validate forward compat by using old type in place of current type
* If breaking change required, add in package.json under typeValidation.broken:
* "ClassDeclaration_FileDocumentService": {"forwardCompat": false}
*/
declare function get_old_ClassDeclaration_FileDocumentService():
    TypeOnly<old.FileDocumentService>;
declare function use_current_ClassDeclaration_FileDocumentService(
    use: TypeOnly<current.FileDocumentService>);
use_current_ClassDeclaration_FileDocumentService(
    get_old_ClassDeclaration_FileDocumentService());

/*
* Validate back compat by using current type in place of old type
* If breaking change required, add in package.json under typeValidation.broken:
* "ClassDeclaration_FileDocumentService": {"backCompat": false}
*/
declare function get_current_ClassDeclaration_FileDocumentService():
    TypeOnly<current.FileDocumentService>;
declare function use_old_ClassDeclaration_FileDocumentService(
    use: TypeOnly<old.FileDocumentService>);
use_old_ClassDeclaration_FileDocumentService(
    get_current_ClassDeclaration_FileDocumentService());

/*
* Validate forward compat by using old type in place of current type
* If breaking change required, add in package.json under typeValidation.broken:
* "ClassDeclaration_FileDocumentServiceFactory": {"forwardCompat": false}
*/
declare function get_old_ClassDeclaration_FileDocumentServiceFactory():
    TypeOnly<old.FileDocumentServiceFactory>;
declare function use_current_ClassDeclaration_FileDocumentServiceFactory(
    use: TypeOnly<current.FileDocumentServiceFactory>);
use_current_ClassDeclaration_FileDocumentServiceFactory(
    get_old_ClassDeclaration_FileDocumentServiceFactory());

/*
* Validate back compat by using current type in place of old type
* If breaking change required, add in package.json under typeValidation.broken:
* "ClassDeclaration_FileDocumentServiceFactory": {"backCompat": false}
*/
declare function get_current_ClassDeclaration_FileDocumentServiceFactory():
    TypeOnly<current.FileDocumentServiceFactory>;
declare function use_old_ClassDeclaration_FileDocumentServiceFactory(
    use: TypeOnly<old.FileDocumentServiceFactory>);
use_old_ClassDeclaration_FileDocumentServiceFactory(
    get_current_ClassDeclaration_FileDocumentServiceFactory());

/*
* Validate forward compat by using old type in place of current type
* If breaking change required, add in package.json under typeValidation.broken:
* "VariableDeclaration_FileSnapshotWriterClassFactory": {"forwardCompat": false}
*/
declare function get_old_VariableDeclaration_FileSnapshotWriterClassFactory():
    TypeOnly<typeof old.FileSnapshotWriterClassFactory>;
declare function use_current_VariableDeclaration_FileSnapshotWriterClassFactory(
    use: TypeOnly<typeof current.FileSnapshotWriterClassFactory>);
use_current_VariableDeclaration_FileSnapshotWriterClassFactory(
    get_old_VariableDeclaration_FileSnapshotWriterClassFactory());

/*
* Validate back compat by using current type in place of old type
* If breaking change required, add in package.json under typeValidation.broken:
* "VariableDeclaration_FileSnapshotWriterClassFactory": {"backCompat": false}
*/
declare function get_current_VariableDeclaration_FileSnapshotWriterClassFactory():
    TypeOnly<typeof current.FileSnapshotWriterClassFactory>;
declare function use_old_VariableDeclaration_FileSnapshotWriterClassFactory(
    use: TypeOnly<typeof old.FileSnapshotWriterClassFactory>);
use_old_VariableDeclaration_FileSnapshotWriterClassFactory(
    get_current_VariableDeclaration_FileSnapshotWriterClassFactory());

/*
* Validate forward compat by using old type in place of current type
* If breaking change required, add in package.json under typeValidation.broken:
* "VariableDeclaration_FileStorageDocumentName": {"forwardCompat": false}
*/
declare function get_old_VariableDeclaration_FileStorageDocumentName():
    TypeOnly<typeof old.FileStorageDocumentName>;
declare function use_current_VariableDeclaration_FileStorageDocumentName(
    use: TypeOnly<typeof current.FileStorageDocumentName>);
use_current_VariableDeclaration_FileStorageDocumentName(
    get_old_VariableDeclaration_FileStorageDocumentName());

/*
* Validate back compat by using current type in place of old type
* If breaking change required, add in package.json under typeValidation.broken:
* "VariableDeclaration_FileStorageDocumentName": {"backCompat": false}
*/
declare function get_current_VariableDeclaration_FileStorageDocumentName():
    TypeOnly<typeof current.FileStorageDocumentName>;
declare function use_old_VariableDeclaration_FileStorageDocumentName(
    use: TypeOnly<typeof old.FileStorageDocumentName>);
use_old_VariableDeclaration_FileStorageDocumentName(
    get_current_VariableDeclaration_FileStorageDocumentName());

/*
* Validate forward compat by using old type in place of current type
* If breaking change required, add in package.json under typeValidation.broken:
* "ClassDeclaration_FluidFetchReader": {"forwardCompat": false}
*/
declare function get_old_ClassDeclaration_FluidFetchReader():
    TypeOnly<old.FluidFetchReader>;
declare function use_current_ClassDeclaration_FluidFetchReader(
    use: TypeOnly<current.FluidFetchReader>);
use_current_ClassDeclaration_FluidFetchReader(
    get_old_ClassDeclaration_FluidFetchReader());

/*
* Validate back compat by using current type in place of old type
* If breaking change required, add in package.json under typeValidation.broken:
* "ClassDeclaration_FluidFetchReader": {"backCompat": false}
*/
declare function get_current_ClassDeclaration_FluidFetchReader():
    TypeOnly<current.FluidFetchReader>;
declare function use_old_ClassDeclaration_FluidFetchReader(
    use: TypeOnly<old.FluidFetchReader>);
use_old_ClassDeclaration_FluidFetchReader(
    get_current_ClassDeclaration_FluidFetchReader());

/*
* Validate forward compat by using old type in place of current type
* If breaking change required, add in package.json under typeValidation.broken:
* "VariableDeclaration_FluidFetchReaderFileSnapshotWriter": {"forwardCompat": false}
*/
declare function get_old_VariableDeclaration_FluidFetchReaderFileSnapshotWriter():
    TypeOnly<typeof old.FluidFetchReaderFileSnapshotWriter>;
declare function use_current_VariableDeclaration_FluidFetchReaderFileSnapshotWriter(
    use: TypeOnly<typeof current.FluidFetchReaderFileSnapshotWriter>);
use_current_VariableDeclaration_FluidFetchReaderFileSnapshotWriter(
    get_old_VariableDeclaration_FluidFetchReaderFileSnapshotWriter());

/*
* Validate back compat by using current type in place of old type
* If breaking change required, add in package.json under typeValidation.broken:
* "VariableDeclaration_FluidFetchReaderFileSnapshotWriter": {"backCompat": false}
*/
declare function get_current_VariableDeclaration_FluidFetchReaderFileSnapshotWriter():
    TypeOnly<typeof current.FluidFetchReaderFileSnapshotWriter>;
declare function use_old_VariableDeclaration_FluidFetchReaderFileSnapshotWriter(
    use: TypeOnly<typeof old.FluidFetchReaderFileSnapshotWriter>);
use_old_VariableDeclaration_FluidFetchReaderFileSnapshotWriter(
    get_current_VariableDeclaration_FluidFetchReaderFileSnapshotWriter());

/*
* Validate forward compat by using old type in place of current type
* If breaking change required, add in package.json under typeValidation.broken:
* "InterfaceDeclaration_ISnapshotWriterStorage": {"forwardCompat": false}
*/
declare function get_old_InterfaceDeclaration_ISnapshotWriterStorage():
    TypeOnly<old.ISnapshotWriterStorage>;
declare function use_current_InterfaceDeclaration_ISnapshotWriterStorage(
    use: TypeOnly<current.ISnapshotWriterStorage>);
use_current_InterfaceDeclaration_ISnapshotWriterStorage(
    get_old_InterfaceDeclaration_ISnapshotWriterStorage());

/*
* Validate back compat by using current type in place of old type
* If breaking change required, add in package.json under typeValidation.broken:
* "InterfaceDeclaration_ISnapshotWriterStorage": {"backCompat": false}
*/
declare function get_current_InterfaceDeclaration_ISnapshotWriterStorage():
    TypeOnly<current.ISnapshotWriterStorage>;
declare function use_old_InterfaceDeclaration_ISnapshotWriterStorage(
    use: TypeOnly<old.ISnapshotWriterStorage>);
use_old_InterfaceDeclaration_ISnapshotWriterStorage(
    get_current_InterfaceDeclaration_ISnapshotWriterStorage());

/*
* Validate forward compat by using old type in place of current type
* If breaking change required, add in package.json under typeValidation.broken:
* "TypeAliasDeclaration_ReaderConstructor": {"forwardCompat": false}
*/
declare function get_old_TypeAliasDeclaration_ReaderConstructor():
    TypeOnly<old.ReaderConstructor>;
declare function use_current_TypeAliasDeclaration_ReaderConstructor(
    use: TypeOnly<current.ReaderConstructor>);
use_current_TypeAliasDeclaration_ReaderConstructor(
    get_old_TypeAliasDeclaration_ReaderConstructor());

/*
* Validate back compat by using current type in place of old type
* If breaking change required, add in package.json under typeValidation.broken:
* "TypeAliasDeclaration_ReaderConstructor": {"backCompat": false}
*/
declare function get_current_TypeAliasDeclaration_ReaderConstructor():
    TypeOnly<current.ReaderConstructor>;
declare function use_old_TypeAliasDeclaration_ReaderConstructor(
    use: TypeOnly<old.ReaderConstructor>);
use_old_TypeAliasDeclaration_ReaderConstructor(
    get_current_TypeAliasDeclaration_ReaderConstructor());

/*
* Validate forward compat by using old type in place of current type
* If breaking change required, add in package.json under typeValidation.broken:
* "ClassDeclaration_ReplayFileDeltaConnection": {"forwardCompat": false}
*/
declare function get_old_ClassDeclaration_ReplayFileDeltaConnection():
    TypeOnly<old.ReplayFileDeltaConnection>;
declare function use_current_ClassDeclaration_ReplayFileDeltaConnection(
    use: TypeOnly<current.ReplayFileDeltaConnection>);
use_current_ClassDeclaration_ReplayFileDeltaConnection(
    get_old_ClassDeclaration_ReplayFileDeltaConnection());

/*
* Validate back compat by using current type in place of old type
* If breaking change required, add in package.json under typeValidation.broken:
* "ClassDeclaration_ReplayFileDeltaConnection": {"backCompat": false}
*/
declare function get_current_ClassDeclaration_ReplayFileDeltaConnection():
    TypeOnly<current.ReplayFileDeltaConnection>;
declare function use_old_ClassDeclaration_ReplayFileDeltaConnection(
    use: TypeOnly<old.ReplayFileDeltaConnection>);
use_old_ClassDeclaration_ReplayFileDeltaConnection(
    get_current_ClassDeclaration_ReplayFileDeltaConnection());

/*
* Validate forward compat by using old type in place of current type
* If breaking change required, add in package.json under typeValidation.broken:
* "ClassDeclaration_Replayer": {"forwardCompat": false}
*/
declare function get_old_ClassDeclaration_Replayer():
    TypeOnly<old.Replayer>;
declare function use_current_ClassDeclaration_Replayer(
    use: TypeOnly<current.Replayer>);
use_current_ClassDeclaration_Replayer(
    get_old_ClassDeclaration_Replayer());

/*
* Validate back compat by using current type in place of old type
* If breaking change required, add in package.json under typeValidation.broken:
* "ClassDeclaration_Replayer": {"backCompat": false}
*/
declare function get_current_ClassDeclaration_Replayer():
    TypeOnly<current.Replayer>;
declare function use_old_ClassDeclaration_Replayer(
    use: TypeOnly<old.Replayer>);
use_old_ClassDeclaration_Replayer(
    get_current_ClassDeclaration_Replayer());
