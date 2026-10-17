# HLP-412: Automated reminders for unsigned subscription documents

**Type:** Story · **Priority:** High · **Reporter:** Dana Ruiz · **Due:** 2026-12-11

## Description

As an IR manager, I want investors who haven't signed their subscription documents to receive automatic reminders, so that closings aren't delayed by manual chasing.

## Acceptance criteria

1. A reminder is sent N days after documents are sent if the investor hasn't signed.
2. Reminders repeat on an escalating schedule up to the closing date, with a final notice 48h before.
3. IR can pause or resume reminders per investor and per closing.
4. Every reminder sent is logged and visible to IR.
5. Emails use the fund's branding and sender address.

## Notes

- Reply routing to the right IR person: nice to have.
- Outstanding signatures view: TBD.
