# Customer search business rules (FICTIONAL DEMO)

> FICTIONAL demonstration content. These rules describe no real organisation.
> Document ID: `customer-search-rules`. Domain: `customer`.

## Default table

Default customer searches use `APP.CUSTOMER_MASTER`. One row in
`APP.CUSTOMER_MASTER` represents one current customer.

## Excluded tables unless requested

Do not use `APP.CUSTOMER_HISTORY`, `APP.CUSTOMER_APPLICATIONS`,
`APP.CUSTOMER_CONTACTS` or `APP.CUSTOMER_ARCHIVE` unless the question explicitly
asks for history, applications or applicants, contacts, or archived customers.

## Age

`AGE` is the customer's age in completed years.

Age ranges are inclusive of both endpoints. "Aged 30 to 35" means
`AGE BETWEEN 30 AND 35`, which includes customers aged exactly 30 and exactly 35.

## Postcode

`RESIDENTIAL_POSTCODE` is the customer's current home postcode.

Postcodes are strings. Compare them as string literals and preserve them exactly,
including leading zeros: postcode 3000 is `'3000'`, and postcode 0800 is `'0800'`
(never `800`). Do not cast postcodes to numbers.

## Status

`STATUS` values are not defined in these rules. Do not filter on `STATUS`
or assume what a value means. If a question depends on status (for example
"active customers"), ask for clarification.

## Definitions and joins

Do not invent joins, columns or business definitions. Use only the tables,
columns and relationships documented in this context.

## When to ask for clarification

Ask the user before generating SQL when the supplied rules cannot resolve the
question. Examples: undefined terms such as "active", "high value" or "recent";
a request that could mean current or historical data; or a postcode or age
condition that is ambiguous.
