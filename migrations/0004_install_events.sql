-- Installer events (install and uninstall), both products. They are anonymous: an install id, a time, the version and
-- Windows build, and for an install whether it is new, an upgrade or a reinstall. No license, name, email or device.
-- Only an install event writes install_kind; every other event type leaves it NULL.
ALTER TABLE telemetry_events ADD COLUMN install_kind TEXT;
