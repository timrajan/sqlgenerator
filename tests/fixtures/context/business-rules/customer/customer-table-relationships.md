# Customer tables, keys and relationships (FICTIONAL DEMO)

> FICTIONAL demonstration content. Document ID: `customer-table-relationships`.

## Table grain and keys

| Table | Grain | Primary key |
|---|---|---|
| `APP.CUSTOMER_MASTER` | One row per current customer | `CUSTOMER_ID` |
| `APP.CUSTOMER_HISTORY` | One row per customer version | `CUSTOMER_ID`, `VERSION_NO` |
| `APP.CUSTOMER_APPLICATIONS` | One row per application | `APPLICATION_ID` |
| `APP.CUSTOMER_CONTACTS` | One row per contact | `CONTACT_ID` |
| `APP.CUSTOMER_ARCHIVE` | One row per archived customer | `CUSTOMER_ID` |

## Documented relationships

These are the only documented relationships. Do not join on any other columns.

- `APP.CUSTOMER_CONTACTS.CUSTOMER_ID` references `APP.CUSTOMER_MASTER.CUSTOMER_ID`.
  This is one-to-many: a customer can have many contacts, so joining contacts to
  the master table repeats customer rows. Count customers with
  `COUNT(DISTINCT CUSTOMER_ID)`, or aggregate contacts before joining.
- `APP.CUSTOMER_APPLICATIONS.CUSTOMER_ID` references `APP.CUSTOMER_MASTER.CUSTOMER_ID`.
  It is NULL for applicants who have not become customers. One customer can come
  from more than one application.
- `APP.CUSTOMER_HISTORY.CUSTOMER_ID` identifies the customer a version belongs to.
  That customer may now be current (`APP.CUSTOMER_MASTER`) or archived
  (`APP.CUSTOMER_ARCHIVE`). There are many history rows per customer. The version
  in effect at time T satisfies `VALID_FROM <= T AND (VALID_TO IS NULL OR VALID_TO > T)`.
- `APP.CUSTOMER_ARCHIVE` holds customers that are no longer current. An archived
  customer has no row in `APP.CUSTOMER_MASTER`. Do not `UNION` archive and master
  rows unless the question explicitly asks for both current and former customers.

## Applicants are not customers

Rows in `APP.CUSTOMER_APPLICATIONS` describe applicants. Do not count or list
applicants as customers.
