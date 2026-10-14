-- FICTIONAL DEMO SCHEMA. Not a real system.
-- Grain: one row per customer version. Primary key: (CUSTOMER_ID, VERSION_NO).
-- CUSTOMER_ID refers to the customer whose history this is; the customer may now be in
-- APP.CUSTOMER_MASTER or APP.CUSTOMER_ARCHIVE, so no foreign key is declared.
CREATE TABLE APP.CUSTOMER_HISTORY (
    CUSTOMER_ID           BIGINT        NOT NULL,
    VERSION_NO            INTEGER       NOT NULL,
    CUSTOMER_NAME         VARCHAR(200)  NOT NULL,
    AGE                   SMALLINT,
    RESIDENTIAL_POSTCODE  VARCHAR(10),
    STATUS                VARCHAR(20)   NOT NULL,
    VALID_FROM            TIMESTAMP     NOT NULL,
    VALID_TO              TIMESTAMP,
    CONSTRAINT PK_CUSTOMER_HISTORY PRIMARY KEY (CUSTOMER_ID, VERSION_NO)
);

COMMENT ON TABLE APP.CUSTOMER_HISTORY IS 'FICTIONAL: historical customer versions; many rows per customer';
COMMENT ON COLUMN APP.CUSTOMER_HISTORY.VERSION_NO IS 'Version sequence per customer, starting at 1';
COMMENT ON COLUMN APP.CUSTOMER_HISTORY.AGE IS 'Age in completed years as recorded in this version';
COMMENT ON COLUMN APP.CUSTOMER_HISTORY.VALID_FROM IS 'Start of the period this version was current (inclusive)';
COMMENT ON COLUMN APP.CUSTOMER_HISTORY.VALID_TO IS 'End of the period this version was current (exclusive); NULL for the latest version';
