/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { fail, strict as assert } from "assert";
import { validateAssertionError } from "@fluidframework/test-runtime-utils";
import {
	defaultSchemaPolicy,
	FieldKinds,
	Multiplicity,
	getPrimaryField,
	getFieldKind,
	getFieldSchema,
	SchemaBuilder,
} from "../../../feature-libraries";
import {
	LocalFieldKey,
	FieldStoredSchema,
	InMemoryStoredSchemaRepository,
	EmptyKey,
	rootFieldKey,
	symbolFromKey,
} from "../../../core";
import { brand } from "../../../util";
import {
	isPrimitive,
	getOwnArrayKeys,
	keyIsValidIndex,
	// eslint-disable-next-line import/no-internal-modules
} from "../../../feature-libraries/editable-tree/utilities";
import {
	arraySchema,
	buildTestSchema,
	int32Schema,
	mapStringSchema,
	optionalChildSchema,
	stringSchema,
} from "./mockData";

describe("editable-tree utilities", () => {
	it("isPrimitive", () => {
		assert(isPrimitive(int32Schema));
		assert(isPrimitive(stringSchema));
		assert(!isPrimitive(mapStringSchema));
		assert(!isPrimitive(optionalChildSchema));
	});

	it("field utils", () => {
		const schema =
			arraySchema.localFields.get(EmptyKey) ?? fail("Expected primary array field");
		const expectedPrimary: { key: LocalFieldKey; schema: FieldStoredSchema } = {
			key: EmptyKey,
			schema,
		};

		const rootSchema = SchemaBuilder.field(FieldKinds.value, arraySchema);
		const fullSchemaData = buildTestSchema(rootSchema);
		const fullSchema = new InMemoryStoredSchemaRepository(defaultSchemaPolicy, fullSchemaData);
		assert.equal(getFieldSchema(symbolFromKey(rootFieldKey), fullSchema), fullSchemaData.root);
		assert.throws(
			() => getFieldSchema(brand(rootFieldKey), fullSchema),
			(e) =>
				validateAssertionError(
					e,
					"The field is a local field, a parent schema is required.",
				),
			"Expected exception was not thrown",
		);
		const primary = getPrimaryField(arraySchema);
		assert(primary !== undefined);
		assert.deepEqual(getFieldSchema(primary.key, fullSchema, arraySchema), schema);
		assert.equal(
			getFieldKind(getFieldSchema(primary.key, fullSchema, arraySchema)).multiplicity,
			Multiplicity.Sequence,
		);
		assert.deepEqual(primary, expectedPrimary);
		assert(getPrimaryField(optionalChildSchema) === undefined);
		assert(getPrimaryField(mapStringSchema) === undefined);
	});

	it("get array-like keys", () => {
		assert.deepEqual(getOwnArrayKeys(1), Object.getOwnPropertyNames([""]));
		assert.deepEqual(getOwnArrayKeys(0), Object.getOwnPropertyNames([]));
		assert.deepEqual(getOwnArrayKeys(1), [...Object.keys([""]), "length"]);
		assert.deepEqual(getOwnArrayKeys(0), [...Object.keys([]), "length"]);
	});

	it("key is a valid array index", () => {
		assert.equal(keyIsValidIndex(0, 1), true);
		assert.equal(keyIsValidIndex(0, 0), false);
		assert.equal(keyIsValidIndex("0", 1), true);
		assert.equal(keyIsValidIndex("0", 0), false);
		assert.equal(keyIsValidIndex("0.0", 1), false);
		assert.equal(keyIsValidIndex(-1, 2), false);
		assert.equal(keyIsValidIndex("-1", 2), false);
		assert.equal(keyIsValidIndex("-1.5", 2), false);
		assert.equal(keyIsValidIndex("1.5", 2), false);
		assert.equal(keyIsValidIndex("1.x", 2), false);
		assert.equal(keyIsValidIndex("-1.x", 2), false);
		assert.equal(keyIsValidIndex(NaN, 1), false);
		assert.equal(keyIsValidIndex(Infinity, 1), false);
		assert.equal(keyIsValidIndex("NaN", 1), false);
		assert.equal(keyIsValidIndex("Infinity", 1), false);
	});
});
