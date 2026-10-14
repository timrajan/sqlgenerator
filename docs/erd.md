# Customer domain ERD (FICTIONAL DEMO)

This diagram is for people only. The MCP server does not serve it. The source of truth is:

- `context/schema/customer/*.sql`: table DDL and declared foreign keys
- `context/business-rules/customer/customer-table-relationships.md`: grain, keys and documented relationships

If you change either of those, update this diagram to match.

```mermaid
erDiagram
    CUSTOMER_MASTER ||--o{ CUSTOMER_CONTACTS : "has (FK CUSTOMER_ID)"
    CUSTOMER_MASTER |o--o{ CUSTOMER_APPLICATIONS : "converted from (nullable FK CUSTOMER_ID)"
    CUSTOMER_MASTER ||..o{ CUSTOMER_HISTORY : "versions (logical, no FK)"
    CUSTOMER_ARCHIVE ||..o{ CUSTOMER_HISTORY : "versions (logical, no FK)"

    CUSTOMER_MASTER {
        BIGINT CUSTOMER_ID PK
        VARCHAR CUSTOMER_NAME
        SMALLINT AGE
        VARCHAR RESIDENTIAL_POSTCODE
        VARCHAR STATUS
    }
    CUSTOMER_HISTORY {
        BIGINT CUSTOMER_ID PK
        INTEGER VERSION_NO PK
        VARCHAR CUSTOMER_NAME
        SMALLINT AGE
        VARCHAR RESIDENTIAL_POSTCODE
        VARCHAR STATUS
        TIMESTAMP VALID_FROM
        TIMESTAMP VALID_TO
    }
    CUSTOMER_APPLICATIONS {
        BIGINT APPLICATION_ID PK
        VARCHAR APPLICANT_NAME
        SMALLINT AGE
        VARCHAR RESIDENTIAL_POSTCODE
        DATE APPLICATION_DATE
        VARCHAR APPLICATION_STATUS
        BIGINT CUSTOMER_ID FK "nullable"
    }
    CUSTOMER_CONTACTS {
        BIGINT CONTACT_ID PK
        BIGINT CUSTOMER_ID FK
        VARCHAR CONTACT_NAME
        VARCHAR CONTACT_ROLE
        VARCHAR EMAIL_ADDRESS
        VARCHAR PHONE_NUMBER
    }
    CUSTOMER_ARCHIVE {
        BIGINT CUSTOMER_ID PK
        VARCHAR CUSTOMER_NAME
        SMALLINT AGE
        VARCHAR RESIDENTIAL_POSTCODE
        VARCHAR STATUS
        DATE ARCHIVED_DATE
        VARCHAR ARCHIVE_REASON
    }
```

All tables are in schema `APP`. The diagram leaves the prefix off because Mermaid entity names can't contain dots.

## Reading the diagram

- **Solid lines** are foreign keys declared in the DDL.
- **Dotted lines** are relationships described in the rules but not enforced. `CUSTOMER_HISTORY.CUSTOMER_ID` can belong to a current customer or an archived one.
- **There is no link between `CUSTOMER_ARCHIVE` and `CUSTOMER_MASTER`.** An archived customer no longer has a row in the master table.
- **Joining contacts repeats customer rows.** It's one-to-many, so use `COUNT(DISTINCT CUSTOMER_ID)` or aggregate contacts before joining.
- **Applicants aren't customers.** `CUSTOMER_APPLICATIONS.CUSTOMER_ID` is NULL until an application is converted.
