{
  "contextVersion": "demo-2026-10-13.1",
  "description": "FICTIONAL demonstration context. Replace with your organisation's reviewed schema and business documents before real use.",
  "fictional": true,
  "db2": {
    "platform": "unspecified",
    "version": null,
    "notes": "The demo does not target LUW, z/OS or IBM i. Platform-specific SQL must be flagged as an assumption."
  },
  "domains": [
    {
      "id": "customer",
      "name": "Customer (FICTIONAL DEMO)",
      "description": "Fictional customer master data, history, applications, contacts and archive. Default customer searches use APP.CUSTOMER_MASTER.",
      "fictional": true
    }
  ],
  "tables": [
    {
      "name": "APP.CUSTOMER_MASTER",
      "domain": "customer",
      "schemaPath": "schema/customer/APP.CUSTOMER_MASTER.sql",
      "description": "Current customers. Default table for customer searches. Columns: CUSTOMER_ID, CUSTOMER_NAME, AGE (completed years), RESIDENTIAL_POSTCODE (current home postcode, string), STATUS.",
      "grain": "One row per current customer.",
      "primaryKey": ["CUSTOMER_ID"],
      "tags": ["customer", "current", "default", "age", "postcode", "name"]
    },
    {
      "name": "APP.CUSTOMER_HISTORY",
      "domain": "customer",
      "schemaPath": "schema/customer/APP.CUSTOMER_HISTORY.sql",
      "description": "Historical versions of customer records with validity periods. Use only when history or point-in-time values are explicitly requested.",
      "grain": "One row per customer per version (CUSTOMER_ID, VERSION_NO).",
      "primaryKey": ["CUSTOMER_ID", "VERSION_NO"],
      "tags": ["customer", "history", "historical", "version", "point-in-time"]
    },
    {
      "name": "APP.CUSTOMER_APPLICATIONS",
      "domain": "customer",
      "schemaPath": "schema/customer/APP.CUSTOMER_APPLICATIONS.sql",
      "description": "Applications from applicants who may not yet be customers. Use only when applications or applicants are explicitly requested.",
      "grain": "One row per application.",
      "primaryKey": ["APPLICATION_ID"],
      "tags": ["application", "applicant", "prospect", "onboarding"]
    },
    {
      "name": "APP.CUSTOMER_CONTACTS",
      "domain": "customer",
      "schemaPath": "schema/customer/APP.CUSTOMER_CONTACTS.sql",
      "description": "Contacts associated with customer accounts. A customer can have many contacts. Use only when contacts are explicitly requested.",
      "grain": "One row per contact; many contacts per CUSTOMER_ID.",
      "primaryKey": ["CONTACT_ID"],
      "tags": ["contact", "contacts", "email", "phone", "account"]
    },
    {
      "name": "APP.CUSTOMER_ARCHIVE",
      "domain": "customer",
      "schemaPath": "schema/customer/APP.CUSTOMER_ARCHIVE.sql",
      "description": "Customers archived (no longer current). Use only when archived or former customers are explicitly requested.",
      "grain": "One row per archived customer.",
      "primaryKey": ["CUSTOMER_ID"],
      "tags": ["archive", "archived", "former", "closed"]
    }
  ],
  "documents": [
    {
      "id": "customer-search-rules",
      "domain": "customer",
      "title": "Customer search business rules (FICTIONAL)",
      "path": "business-rules/customer/customer-search-rules.md",
      "tags": ["customer", "search", "age", "postcode", "default", "rules"]
    },
    {
      "id": "customer-table-relationships",
      "domain": "customer",
      "title": "Customer tables, keys and relationships (FICTIONAL)",
      "path": "business-rules/customer/customer-table-relationships.md",
      "tags": ["customer", "join", "relationship", "keys", "grain", "history", "contacts", "archive", "applications"]
    }
  ]
}
