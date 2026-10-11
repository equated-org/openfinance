import { parse, deparse } from "pgsql-parser";

export const MAX_QUERY_ROWS = 1000;
export const MAX_QUERY_LENGTH = 2000;

export class TransactionQueryError extends Error {}

type AstObject = Record<string, unknown>;
type Policy = Record<string, string>;

// Raw parser nodes only. Both nodes AND fields are allowlisted: newly introduced
// grammar must be reviewed rather than silently becoming executable SQL.
const policies: Record<string, Policy> = {
  SelectStmt: {
    distinctClause: "distinct",
    targetList: "nodes",
    fromClause: "nodes",
    whereClause: "node",
    groupClause: "nodes",
    havingClause: "node",
    sortClause: "nodes",
    limitOffset: "node",
    limitCount: "node",
    limitOption: "scalar",
    op: "scalar",
    all: "scalar",
    larg: "SelectStmt",
    rarg: "SelectStmt",
  },
  ResTarget: { name: "scalar", val: "node", location: "scalar" },
  RangeVar: {
    catalogname: "scalar",
    schemaname: "scalar",
    relname: "scalar",
    inh: "scalar",
    relpersistence: "scalar",
    alias: "Alias",
    location: "scalar",
  },
  RangeSubselect: { lateral: "scalar", subquery: "node", alias: "Alias" },
  JoinExpr: {
    jointype: "scalar",
    isNatural: "scalar",
    larg: "node",
    rarg: "node",
    usingClause: "nodes",
    join_using_alias: "Alias",
    quals: "node",
    alias: "Alias",
  },
  Alias: { aliasname: "scalar", colnames: "nodes" },
  ColumnRef: { fields: "nodes", location: "scalar" },
  FuncCall: {
    funcname: "nodes",
    args: "nodes",
    agg_order: "nodes",
    agg_filter: "node",
    agg_star: "scalar",
    agg_distinct: "scalar",
    funcformat: "scalar",
    location: "scalar",
  },
  TypeCast: { arg: "node", typeName: "TypeName", location: "scalar" },
  TypeName: {
    names: "nodes",
    typmods: "nodes",
    typemod: "scalar",
    location: "scalar",
  },
  A_Expr: {
    kind: "scalar",
    name: "nodes",
    lexpr: "node",
    rexpr: "node",
    location: "scalar",
  },
  BoolExpr: { boolop: "scalar", args: "nodes", location: "scalar" },
  NullTest: {
    arg: "node",
    nulltesttype: "scalar",
    argisrow: "scalar",
    location: "scalar",
  },
  BooleanTest: { arg: "node", booltesttype: "scalar", location: "scalar" },
  CaseExpr: {
    arg: "node",
    args: "nodes",
    defresult: "node",
    location: "scalar",
  },
  CaseWhen: { expr: "node", result: "node", location: "scalar" },
  CoalesceExpr: { args: "nodes", location: "scalar" },
  MinMaxExpr: { op: "scalar", args: "nodes", location: "scalar" },
  RowExpr: { args: "nodes", row_format: "scalar", location: "scalar" },
  SubLink: {
    subLinkType: "scalar",
    testexpr: "node",
    operName: "nodes",
    subselect: "node",
    location: "scalar",
  },
  SortBy: {
    node: "node",
    sortby_dir: "scalar",
    sortby_nulls: "scalar",
    location: "scalar",
  },
  SQLValueFunction: { op: "scalar", typmod: "scalar", location: "scalar" },
  List: { items: "nodes" },
  A_Const: {
    isnull: "scalar",
    ival: "Integer",
    fval: "Float",
    sval: "String",
    boolval: "Boolean",
    location: "scalar",
  },
  String: { sval: "scalar" },
  Integer: { ival: "scalar" },
  Float: { fval: "scalar" },
  Boolean: { boolval: "scalar" },
  A_Star: {},
};

const functions = new Set([
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "abs",
  "round",
  "ceil",
  "ceiling",
  "floor",
  "lower",
  "upper",
  "length",
  "trim",
  "btrim",
  "ltrim",
  "rtrim",
  "substring",
  "substr",
  "replace",
  "date_trunc",
  "date_part",
  "extract",
  "to_char",
]);
const types = new Set([
  "bool",
  "int2",
  "int4",
  "int8",
  "numeric",
  "float4",
  "float8",
  "text",
  "varchar",
  "bpchar",
  "date",
  "timestamp",
  "timestamptz",
  "interval",
]);
const operators = [
  "+",
  "-",
  "*",
  "/",
  "%",
  "=",
  "<>",
  "<",
  ">",
  "<=",
  ">=",
  "||",
];
const expressionOperators: Record<string, readonly string[]> = {
  AEXPR_OP: operators,
  AEXPR_IN: ["=", "<>"],
  AEXPR_DISTINCT: ["="],
  AEXPR_NOT_DISTINCT: ["="],
  AEXPR_NULLIF: ["="],
  AEXPR_LIKE: ["~~", "!~~"],
  AEXPR_ILIKE: ["~~*", "!~~*"],
  AEXPR_BETWEEN: ["BETWEEN"],
  AEXPR_NOT_BETWEEN: ["NOT BETWEEN"],
  AEXPR_BETWEEN_SYM: ["BETWEEN SYMMETRIC"],
  AEXPR_NOT_BETWEEN_SYM: ["NOT BETWEEN SYMMETRIC"],
};

function fail(message: string): never {
  throw new TransactionQueryError(message);
}

function object(value: unknown): AstObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("Unsupported SQL structure");
  }
  return value as AstObject;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) fail("Unsupported SQL structure");
  return value;
}

function names(value: unknown): string[] {
  return array(value).map((part) => {
    const name = object(object(part).String).sval;
    if (typeof name !== "string") fail("Unsupported SQL identifier");
    return name;
  });
}

function allowed(
  value: unknown,
  choices: readonly string[],
  label: string,
): void {
  if (typeof value !== "string" || !choices.includes(value)) {
    fail(`Unsupported ${label}: ${String(value)}`);
  }
}

function builtinName(
  value: unknown,
  choices: Set<string>,
  label: string,
): string {
  const parts = names(value);
  const name = parts.at(-1)!;
  if (
    !(
      parts.length === 1 ||
      (parts.length === 2 && parts[0] === "pg_catalog")
    ) ||
    !choices.has(name)
  ) {
    fail(`Unsupported ${label}: ${parts.join(".")}`);
  }
  return name;
}

function operatorName(value: unknown, choices: readonly string[]): void {
  const parts = names(value);
  if (parts.length !== 1) fail("Qualified operators are not supported");
  allowed(parts[0], choices, "operator");
}

type Context = { hasTxns: boolean };

function check(kind: string, node: AstObject, context: Context): void {
  switch (kind) {
    case "SelectStmt":
      allowed(node.op, ["SETOP_NONE", "SETOP_UNION"], "set operation");
      allowed(
        node.limitOption,
        ["LIMIT_OPTION_DEFAULT", "LIMIT_OPTION_COUNT"],
        "LIMIT clause",
      );
      break;
    case "RangeVar":
      if (node.relname !== "txns" || node.schemaname || node.catalogname) {
        fail("Queries may only read the unqualified txns relation");
      }
      context.hasTxns = true;
      break;
    case "ColumnRef":
      if (array(node.fields).length > 2)
        fail("Schema-qualified columns are not supported");
      break;
    case "FuncCall": {
      const name = builtinName(node.funcname, functions, "function");
      // Pin resolution to PostgreSQL built-ins, even if application functions
      // with these names are added later.
      node.funcname = [
        { String: { sval: "pg_catalog" } },
        { String: { sval: name } },
      ];
      allowed(
        node.funcformat,
        ["COERCE_EXPLICIT_CALL", "COERCE_SQL_SYNTAX"],
        "function syntax",
      );
      break;
    }
    case "TypeName": {
      const name = builtinName(node.names, types, "cast type");
      // The deparser can emit SQL-standard type spellings without a schema.
      // Execution also fixes search_path to pg_catalog first for that reason.
      node.names = [
        { String: { sval: "pg_catalog" } },
        { String: { sval: name } },
      ];
      break;
    }
    case "A_Expr": {
      const choices = expressionOperators[String(node.kind)];
      if (!choices) fail(`Unsupported expression: ${String(node.kind)}`);
      operatorName(node.name, choices);
      break;
    }
    case "SubLink":
      allowed(
        node.subLinkType,
        [
          "EXISTS_SUBLINK",
          "ALL_SUBLINK",
          "ANY_SUBLINK",
          "ROWCOMPARE_SUBLINK",
          "EXPR_SUBLINK",
        ],
        "subquery",
      );
      if (node.operName) operatorName(node.operName, operators);
      break;
    case "JoinExpr":
      allowed(
        node.jointype,
        ["JOIN_INNER", "JOIN_LEFT", "JOIN_FULL", "JOIN_RIGHT"],
        "join",
      );
      break;
    case "BoolExpr":
      allowed(
        node.boolop,
        ["AND_EXPR", "OR_EXPR", "NOT_EXPR"],
        "boolean expression",
      );
      break;
    case "NullTest":
      allowed(node.nulltesttype, ["IS_NULL", "IS_NOT_NULL"], "NULL test");
      break;
    case "BooleanTest":
      allowed(
        node.booltesttype,
        [
          "IS_TRUE",
          "IS_NOT_TRUE",
          "IS_FALSE",
          "IS_NOT_FALSE",
          "IS_UNKNOWN",
          "IS_NOT_UNKNOWN",
        ],
        "boolean test",
      );
      break;
    case "MinMaxExpr":
      allowed(node.op, ["IS_GREATEST", "IS_LEAST"], "comparison expression");
      break;
    case "RowExpr":
      allowed(
        node.row_format,
        ["COERCE_EXPLICIT_CALL", "COERCE_IMPLICIT_CAST"],
        "row expression",
      );
      break;
    case "SortBy":
      allowed(
        node.sortby_dir,
        ["SORTBY_DEFAULT", "SORTBY_ASC", "SORTBY_DESC"],
        "sort direction",
      );
      allowed(
        node.sortby_nulls,
        ["SORTBY_NULLS_DEFAULT", "SORTBY_NULLS_FIRST", "SORTBY_NULLS_LAST"],
        "NULL ordering",
      );
      break;
    case "SQLValueFunction":
      allowed(
        node.op,
        [
          "SVFOP_CURRENT_DATE",
          "SVFOP_CURRENT_TIMESTAMP",
          "SVFOP_CURRENT_TIMESTAMP_N",
        ],
        "SQL value expression",
      );
      break;
  }
}

function validateNode(value: unknown, context: Context): void {
  const entries = Object.entries(object(value));
  if (entries.length !== 1) fail("Unsupported SQL node");
  const [kind, content] = entries[0];
  validateObject(kind, content, context);
}

function validateObject(kind: string, value: unknown, context: Context): void {
  const policy = Object.hasOwn(policies, kind) ? policies[kind] : undefined;
  if (!policy) fail(`Unsupported SQL syntax: ${kind}`);
  const node = object(value);
  check(kind, node, context);
  for (const [field, child] of Object.entries(node)) {
    if (!Object.hasOwn(policy, field))
      fail(`Unsupported SQL syntax: ${kind}.${field}`);
    const rule = policy[field];
    switch (rule) {
      case "scalar":
        if (
          child !== null &&
          !["string", "number", "boolean"].includes(typeof child)
        ) {
          fail(`Unsupported SQL value: ${kind}.${field}`);
        }
        break;
      case "node":
        validateNode(child, context);
        break;
      case "nodes":
        for (const item of array(child)) validateNode(item, context);
        break;
      case "distinct":
        // PostgreSQL represents plain DISTINCT with an empty marker node.
        for (const item of array(child)) {
          if (Object.keys(object(item)).length) validateNode(item, context);
        }
        break;
      default:
        validateObject(rule, child, context);
    }
  }
}

function validateParsedQuery(parsed: AstObject): AstObject {
  const statements = array(parsed.stmts);
  if (statements.length !== 1) fail("Exactly one SELECT statement is required");
  const statement = object(statements[0]).stmt;
  const select = object(statement).SelectStmt;
  if (!select) fail("Only SELECT statements are supported");

  const context = { hasTxns: false };
  validateNode(statement, context);
  if (!context.hasTxns) fail("The query must reference txns");
  return object(select);
}

/** Return canonical SQL only after the entire caller-controlled AST is accepted. */
export async function prepareTransactionQuery(
  userSql: string,
): Promise<string> {
  if (
    typeof userSql !== "string" ||
    !userSql.trim() ||
    userSql.length > MAX_QUERY_LENGTH
  ) {
    fail(`SQL must contain 1–${MAX_QUERY_LENGTH} characters`);
  }

  let parsed: AstObject;
  try {
    parsed = object(await parse(userSql));
  } catch (error) {
    fail(
      error instanceof Error
        ? `Invalid SQL: ${error.message}`
        : "Invalid SQL syntax",
    );
  }

  const node = validateParsedQuery(parsed);
  const cap = { A_Const: { ival: { ival: MAX_QUERY_ROWS } } };
  node.limitCount = node.limitCount
    ? { MinMaxExpr: { op: "IS_LEAST", args: [node.limitCount, cap] } }
    : cap;
  node.limitOption = "LIMIT_OPTION_COUNT";
  const canonical = await deparse(parsed);
  // Validate what will actually execute, including literal escaping and the
  // injected cap, rather than relying only on the serializer's fidelity.
  validateParsedQuery(object(await parse(canonical)));
  return canonical;
}
