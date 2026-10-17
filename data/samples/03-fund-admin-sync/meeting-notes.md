# Call with Tidewell + Northgate

Attendees: Leo Varga (Tidewell ops), Aiko Brandt (Northgate client services), delivery lead, engineer

## Notes

- Aiko: Northgate offers a REST API for "some clients" and nightly SFTP CSV files for others. She'll check which Tidewell's contract covers.
- Direction: Leo said "both ways" in the email, but on the call he mostly talked about pulling Northgate's register into the platform. Not settled.
- Conflicts: if an address is updated in both places on the same day, nobody knew which should win.
- Identifiers: Northgate uses its own investor IDs. We'd need to match them to ours. Some investors are duplicated on Northgate's side ("we know, we're cleaning it up").
- Test environment: Aiko "thinks" there's a sandbox but access needs a separate request, which "usually takes a couple of weeks".
- Volume: ~1,200 investors, low change rate (tens of changes per week).
- Leo would like an alert when the sync fails, and a page showing what changed.
- Existing records: nobody discussed whether the first run should reconcile all existing records or only new changes.
- Bank details are sensitive. Leo wants changes to bank details to be reviewed by a person before they're applied.
