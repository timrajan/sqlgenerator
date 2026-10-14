-- FICTIONAL DEMO SCHEMA. Not a real system.
-- Grain: one row per current customer. Primary key: CUSTOMER_ID.
CREATE TABLE APP.CUSTOMER_MASTER (
    CUSTOMER_ID           BIGINT        NOT NULL,
    CUSTOMER_NAME         VARCHAR(200)  NOT NULL,
    AGE                   SMALLINT,
    RESIDENTIAL_POSTCODE  VARCHAR(10),
    STATUS                VARCHAR(20)   NOT NULL,
    CONSTRAINT PK_CUSTOMER_MASTER PRIMARY KEY (CUSTOMER_ID)
);

COMMENT ON TABLE APP.CUSTOMER_MASTER IS 'FICTIONAL: one row per current customer; default table for customer searches';
COMMENT ON COLUMN APP.CUSTOMER_MASTER.CUSTOMER_ID IS 'Customer identifier';
COMMENT ON COLUMN APP.CUSTOMER_MASTER.CUSTOMER_NAME IS 'Customer full name';
COMMENT ON COLUMN APP.CUSTOMER_MASTER.AGE IS 'Age in completed years';
COMMENT ON COLUMN APP.CUSTOMER_MASTER.RESIDENTIAL_POSTCODE IS 'Current home postcode, stored as a string; preserve leading zeros';
COMMENT ON COLUMN APP.CUSTOMER_MASTER.STATUS IS 'Customer status code; values are not defined in the business rules';
