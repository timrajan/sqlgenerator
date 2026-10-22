-- FICTIONAL DEMO SCHEMA. Not a real system.
-- Grain: one row per contact. Primary key: CONTACT_ID.
-- Many contacts per customer: joining to APP.CUSTOMER_MASTER multiplies customer rows.
CREATE TABLE APP.CUSTOMER_CONTACTS (
    CONTACT_ID            BIGINT        NOT NULL,
    CUSTOMER_ID           BIGINT        NOT NULL,
    CONTACT_NAME          VARCHAR(200)  NOT NULL,
    CONTACT_ROLE          VARCHAR(50),
    EMAIL_ADDRESS         VARCHAR(254),
    PHONE_NUMBER          VARCHAR(30),
    CONSTRAINT PK_CUSTOMER_CONTACTS PRIMARY KEY (CONTACT_ID),
    CONSTRAINT FK_CONTACTS_CUSTOMER FOREIGN KEY (CUSTOMER_ID)
        REFERENCES APP.CUSTOMER_MASTER (CUSTOMER_ID)
);

COMMENT ON TABLE APP.CUSTOMER_CONTACTS IS 'FICTIONAL: contacts associated with customer accounts; many per customer';
COMMENT ON COLUMN APP.CUSTOMER_CONTACTS.CONTACT_ROLE IS 'Free-text role; values are not defined in the business rules';
