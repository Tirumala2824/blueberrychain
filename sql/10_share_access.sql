-- =====================================================================
-- BlueberryChain OS - give someone access to the CoWork deployment
-- (https://ai.snowflake.com, account identifier PNDVHAR-PT70809)
--
-- Run as ACCOUNTADMIN. Edit the three values in the DECLARE block, run the
-- whole file, and send the person the returned login details PRIVATELY.
-- Run it once per person.
--
-- Access granted = "full demo": BBC_AGENT_ROLE can run both demos and
-- approve queued POs in chat. Every action they trigger is still subject to
-- the autonomy thresholds and is audited under their own user name.
--
-- The temporary password is generated here, never stored in this repo, and
-- must be changed at first sign-in. Snowflake may also ask them to enrol MFA.
-- =====================================================================
USE ROLE ACCOUNTADMIN;

EXECUTE IMMEDIATE $$
DECLARE
    -- >>> edit these three values <<<
    v_login VARCHAR DEFAULT 'JANE_DOE';
    v_name  VARCHAR DEFAULT 'Jane Doe';
    v_email VARCHAR DEFAULT 'jane.doe@example.com';
    -- >>> nothing to edit below <<<
    v_pwd   VARCHAR;
    v_first VARCHAR;
    v_last  VARCHAR;
BEGIN
    IF (NOT REGEXP_LIKE(:v_login, '^[A-Za-z][A-Za-z0-9_]{1,63}$')) THEN
        RETURN 'Login must start with a letter and use only letters, digits or underscore.';
    END IF;
    IF (NOT REGEXP_LIKE(:v_email, '^[^@\\s'']+@[^@\\s'']+\\.[^@\\s'']+$')) THEN
        RETURN 'Email does not look valid.';
    END IF;

    -- Upper, lower, digit and symbol guaranteed; 20 characters overall.
    v_pwd := RANDSTR(16, RANDOM()) || 'Bb7!';
    v_first := SPLIT_PART(:v_name, ' ', 1);
    v_last  := TRIM(SUBSTR(:v_name, LENGTH(:v_first) + 1));

    EXECUTE IMMEDIATE
        'CREATE USER IDENTIFIER(''' || UPPER(:v_login) || ''')'
     || ' LOGIN_NAME = ''' || UPPER(:v_login) || ''''
     || ' DISPLAY_NAME = ''' || REPLACE(:v_name, '''', '''''') || ''''
     || ' FIRST_NAME = ''' || REPLACE(:v_first, '''', '''''') || ''''
     || ' LAST_NAME = ''' || REPLACE(:v_last, '''', '''''') || ''''
     || ' EMAIL = ''' || :v_email || ''''
     || ' PASSWORD = ''' || :v_pwd || ''''
     || ' MUST_CHANGE_PASSWORD = TRUE'
     || ' TYPE = PERSON'
     || ' DEFAULT_ROLE = BBC_AGENT_ROLE'
     || ' DEFAULT_WAREHOUSE = BBC_WH'
     || ' COMMENT = ''BlueberryChain OS CoWork demo user''';

    EXECUTE IMMEDIATE 'GRANT ROLE BBC_AGENT_ROLE TO USER IDENTIFIER(''' || UPPER(:v_login) || ''')';

    RETURN 'Created ' || UPPER(:v_login)
        || ' | URL: https://ai.snowflake.com'
        || ' | Account: PNDVHAR-PT70809'
        || ' | Username: ' || UPPER(:v_login)
        || ' | Temporary password: ' || :v_pwd
        || ' | Must change at first sign-in, then pick "BlueberryChain OS".';
EXCEPTION
    WHEN OTHER THEN
        IF (CONTAINS(SQLERRM, 'already exists')) THEN
            RETURN 'User ' || UPPER(:v_login) || ' already exists - nothing changed. To issue a new'
                || ' temporary password: ALTER USER ' || UPPER(:v_login)
                || ' SET PASSWORD = ''<new>'' MUST_CHANGE_PASSWORD = TRUE;';
        END IF;
        RAISE;
END;
$$;

-- To revoke later:
--   DROP USER IF EXISTS <LOGIN>;
