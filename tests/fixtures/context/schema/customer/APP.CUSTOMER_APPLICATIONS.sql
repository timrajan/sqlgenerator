-- FICTIONAL DEMO SCHEMA. Not a real system.
-- Grain: one row per application. Primary key: APPLICATION_ID.
-- Applicants may not be customers. CUSTOMER_ID is populated only after an application
-- is converted into a customer, and refers to APP.CUSTOMER_MASTER.CUSTOMER_ID.
CREATE TABLE APP.CUSTOMER_APPLICATIONS (
    APPLICATION_ID        BIGINT        NOT NULL,
    APPLICANT_NAME        VARCHAR(200)  NOT NULL,
    AGE                   SMALLINT,
    RESIDENTIAL_POSTCODE  VARCHAR(10),
    APPLICATION_DATE      DATE          NOT NULL,
    APPLICATION_STATUS    VARCHAR(20)   NOT NULL,
    CUSTOMER_ID           BIGINT,
    CONSTRAINT PK_CUSTOMER_APPLICATIONS PRIMARY KEY (APPLICATION_ID),
    CONSTRAINT FK_APPLICATIONS_CUSTOMER FOREIGN KEY (CUSTOMER_ID)
        REFERENCES APP.CUSTOMER_MASTER (CUSTOMER_ID)
);

COMMENT ON TABLE APP.CUSTOMER_APPLICATIONS IS 'FICTIONAL: applications from applicants who may not yet be customers';
COMMENT ON COLUMN APP.CUSTOMER_APPLICATIONS.AGE IS 'Applicant age in completed years at application date';
COMMENT ON COLUMN APP.CUSTOMER_APPLICATIONS.CUSTOMER_ID IS 'Set only when the application became a customer; otherwise NULL';
