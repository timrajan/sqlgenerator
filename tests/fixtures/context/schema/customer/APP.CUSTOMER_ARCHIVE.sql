-- FICTIONAL DEMO SCHEMA. Not a real system.
-- Grain: one row per archived customer. Primary key: CUSTOMER_ID.
-- An archived customer no longer has a row in APP.CUSTOMER_MASTER.
CREATE TABLE APP.CUSTOMER_ARCHIVE (
    CUSTOMER_ID           BIGINT        NOT NULL,
    CUSTOMER_NAME         VARCHAR(200)  NOT NULL,
    AGE                   SMALLINT,
    RESIDENTIAL_POSTCODE  VARCHAR(10),
    STATUS                VARCHAR(20)   NOT NULL,
    ARCHIVED_DATE         DATE          NOT NULL,
    ARCHIVE_REASON        VARCHAR(200),
    CONSTRAINT PK_CUSTOMER_ARCHIVE PRIMARY KEY (CUSTOMER_ID)
);

COMMENT ON TABLE APP.CUSTOMER_ARCHIVE IS 'FICTIONAL: archived (former) customers';
COMMENT ON COLUMN APP.CUSTOMER_ARCHIVE.AGE IS 'Age in completed years at the time of archiving';
COMMENT ON COLUMN APP.CUSTOMER_ARCHIVE.RESIDENTIAL_POSTCODE IS 'Home postcode at the time of archiving, stored as a string';
