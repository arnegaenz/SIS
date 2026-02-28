# Bryan's SIS Feedback — Review & Responses
*Date: Feb 27, 2026*

---

## Executive Summary

### 1. "Would be good to display what Partner(s) this summary is for"
**Our response**: The Executive Summary is intentionally network-wide — all partners, all FIs. It's the company health dashboard, not a partner-scoped view. We'll add a subtitle to make that clear and add a narrative layer (what's working, where to tweak). Added to backlog.

### 2. "The success rate includes all user_data_failures which looks terrible. Could we default to System Success Rate?"
**Our response**: Great feedback, you don't sound like Mark, you sound like Bryan!! We agree — added to the backlog to break these out separately and include better details on the exec page calling out the difference between overall and system success rates with proper context.

### 3. "What is Tier defined as for Tier Distribution — seems overloaded if also reporting site tiers"
**Our response**: Already ahead of you. We've moved away from "Tier 1/2/3" to plain-language motivation levels — **Activation, Campaign, and Discovery** — which is actually a company-wide naming convention we're pushing. The Executive Summary already shows these labels. Just need to clean up the section header from "Tier Distribution" to something like "Motivation Distribution." Quick fix.

---

## Cardholder Engagement

### 1. "Filter on partners should be global across all views, not just this one"
**Our response**: The filter IS global — it's shared infrastructure (filters.js) that should show instance → partner → integration → FI from left to right. This may be a login/role rendering issue rather than a missing feature. Added to backlog to debug filter visibility across different access levels and page contexts.

### 2. "Love the proposed actions at the bottom"
**Our response**: ✅ Glad you like it!

### 3. "If I selected just CardSavr from integration field, only OnDot partners should show but all partners are still checked"
**Our response**: This appears to be working correctly — when selecting CardSavr, the FIs filter down to OnDot and OnDot_defaults as expected. May be a login/session issue on your end. Related to the filter debug backlog item.

---

## CS Portfolio Dashboard

### 1. "Like the volume per FI" ✅

### 2. "Early warnings — include instance/partner. What is 'default'?"
**Our response**: This page isn't even in alpha yet — keeping the feedback in the backlog for when we get there. "Default" is all transactions that leverage the instance's default FI.

### 3. "Add OnDot as a partner versus Other"
**Our response**: Backlogged.

---

## Engagement Playbook

### 1. "Really cool but switches to a different view — missing menu at top"
**Our response**: This page shouldn't be in the menu. It's a standalone resource provided directly from the insights calculations — we point FIs/Partners to it as "here is how you best push CardUpdatr." The separate feel is intentional. We'll remove it from the internal navigation.

---

## Supported Sites

### 1. "FANTASTIC... discuss state changes for CardLinks Engage... great start"
**Our response**: I'm super pumped about the Supported Sites page. Sharing either the page or a PDF of the page is a great thing for all customers currently. Glad you like it! State changes for CardLinks Engage is a great future discussion.

### 2. "Can you please add 'if you have any questions, please call Arne directly'?"
**Our response**: 😄

---

## Campaign URL Builder

### 1. "Imagine extending this for CardLinks Engage campaigns — this is a future"
**Our response**: Totally agree! :)

---

## Operations Dashboard

### 1. "Would love consistent partner/instance filter dropdown like Cardholder Engagement"
**Our response**: I haven't focused on the default views of the Operations Dashboard or CS Portfolio yet. Press kiosk mode and check it out — both tell amazing stories from very different perspectives!

---

## Merchant Heatmap

### 1. "Super cool, filters are consistent"
**Our response**: 👍

---

## Alerts and Watchlist

### 1. "Need to look at this more"
**Our response**: No comment.

---

## Real-Time Troubleshooting

### 1. "Not sure I love 'Real Time' — maybe direct data querying"
**Our response**: Real Time is designed to look at any traffic within 4 hours. This is specifically for troubleshooting any issue while on a call with a partner — so "Real Time" is actually the right framing for that use case.

---

## Troubleshoot / Support Lookup

### 1. "Looks like a work in progress. Not sure what this adds from previous views."
**Our response**: The troubleshooting page is incredibly powerful and one of the best troubleshooting pages we have — as long as the data is over 6 hours old. This is the best site to dig into any issue with any partner or FI. Give it another look!

---

## Analysis Pages

### Cardholder Experience Page — "Beautiful. Must have taken hours. Missing menu at top."
**Our response**: I LOVE this page!!! And it took me 48 minutes. 😎

### Customer Success Dashboard — "Doesn't look much different than Executive Summary"
**Our response**: I started this page right after the FI Funnel and have since abandoned it. The hope for the future is that the data here will really drive Customer Success and help identify customers where we can increase MRR.

### Placement Outcomes — "Less interesting versus other views"
**Our response**: Yeah, this was a test page from early on — good call out! Should hide it.

### FI API — "Very useful so we can track all configuration"
**Our response**: Yes! The whole idea is to look globally at all FIs, their config and style data — without ever logging into any portal. Really powerful for internal teams.

### UX Success Paths — "Looks like a work in progress, might overlay with other views"
**Our response**: Yeah, also a work in progress. What I'm learning from this feedback is I should be better about what pages are shown in SIS until they are ready!

### Sources — "Looks like a work in progress"
**Our response**: Yeah — I have to create fake source data at this point. Can't wait until we have Alkami traffic with real sources!

### FI Funnel — "Good data. Looks more like your original spreadsheet reports covered in other views?"
**Our response**: You are totally right! This was the first page I built once I had access to the CardSavr APIs for reporting data. The Job Outcome Breakdown cards are incredibly powerful. Oh, and select Alkami as a partner and you can see the SSO vs non-SSO traffic for all Alkami FIs!

