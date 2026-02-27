export const TERMINATION_RULES = {
  BILLABLE: {
    label: "Successful",
    includeInHealth: true,
    includeInUx: false,
    severity: "success",
  },
  SITE_INTERACTION_FAILURE: {
    label: "Automation / site failed",
    includeInHealth: true,
    includeInUx: false,
    severity: "site-failure",
  },
  UNSUCCESSFUL: {
    label: "Ran but didn’t complete",
    includeInHealth: true,
    includeInUx: false,
    severity: "site-failure",
  },

  // ===== UX / user-driven stuff =====
  USER_DATA_FAILURE: {
    label: "Bad or missing user data",
    includeInHealth: false,
    includeInUx: true,
    severity: "ux",
  },
  NEVER_STARTED: {
    label: "User didn’t proceed",
    includeInHealth: false,
    includeInUx: true,
    severity: "ux",
  },
  TIMEOUT_CREDENTIALS: {
    label: "User didn’t finish login",
    includeInHealth: false,
    includeInUx: true,
    severity: "ux",
  },
  TIMEOUT_TFA: {
    label: "User didn’t finish MFA",
    includeInHealth: false,
    includeInUx: true,
    severity: "ux",
  },
  ABANDONED_QUICKSTART: {
    label: "User bailed from QuickStart",
    includeInHealth: false,
    includeInUx: true,
    severity: "ux",
  },
  CANCELED: {
    label: "User canceled",
    includeInHealth: false,
    includeInUx: true,
    severity: "ux",
  },
  ACCOUNT_SETUP_INCOMPLETE: {
    label: "User didn’t finish setup",
    includeInHealth: false,
    includeInUx: true,
    severity: "ux",
  },
  TOO_MANY_LOGIN_FAILURES: {
    label: "User kept failing login",
    includeInHealth: false,
    includeInUx: true,
    severity: "ux",
  },
  ACCOUNT_LOCKED: {
    label: "User account locked",
    includeInHealth: false,
    includeInUx: true,
    severity: "ux",
  },
  PASSWORD_RESET_REQUIRED: {
    label: "Password reset needed",
    includeInHealth: false,
    includeInUx: true,
    severity: "ux",
  },
  INVALID_CARD_DETAILS: {
    label: "Bad card info",
    includeInHealth: false,
    includeInUx: true,
    severity: "ux",
  },

  UNKNOWN: {
    label: "Unknown",
    includeInHealth: false,
    includeInUx: false,
    severity: "unknown",
  },
};

// Customer-facing plain-English explanations + suggested actions
export const CUSTOMER_TERMINATION_MAP = {
  BILLABLE: {
    explanation: "Card updated successfully",
    action: "Your card was updated at this merchant.",
    severity: "success",
  },
  SITE_INTERACTION_FAILURE: {
    explanation: "Merchant site issue",
    action: "Temporary issue with the merchant's website. Try again later.",
    severity: "error",
  },
  USER_DATA_FAILURE: {
    explanation: "Incorrect login credentials",
    action: "Verify your username and password for this merchant and try again.",
    severity: "warning",
  },
  NEVER_STARTED: {
    explanation: "Update not started",
    action: "The session ended before the update began. Try again anytime.",
    severity: "warning",
  },
  TIMEOUT_CREDENTIALS: {
    explanation: "Login timed out",
    action: "Login step took too long. Try again and enter credentials promptly.",
    severity: "warning",
  },
  TIMEOUT_TFA: {
    explanation: "Two-factor auth timed out",
    action: "Two-factor step wasn't completed in time. Try again.",
    severity: "warning",
  },
  CANCELED: {
    explanation: "Cardholder canceled",
    action: "The update was canceled. Try again anytime.",
    severity: "warning",
  },
  ACCOUNT_LOCKED: {
    explanation: "Merchant account locked",
    action: "Unlock your account at the merchant first, then try again.",
    severity: "warning",
  },
  PASSWORD_RESET_REQUIRED: {
    explanation: "Password reset required",
    action: "Reset your password at the merchant first, then try again.",
    severity: "warning",
  },
  TOO_MANY_LOGIN_FAILURES: {
    explanation: "Too many login attempts",
    action: "Verify credentials and try again later.",
    severity: "warning",
  },
  INVALID_CARD_DETAILS: {
    explanation: "Invalid card information",
    action: "Verify card number, expiration, and CVV.",
    severity: "warning",
  },
  UNSUCCESSFUL: {
    explanation: "Update could not be completed",
    action: "Try again. If issue persists, contact support.",
    severity: "error",
  },
  ABANDONED_QUICKSTART: {
    explanation: "Setup not completed",
    action: "Initial setup wasn't completed. Try again anytime.",
    severity: "warning",
  },
  ACCOUNT_SETUP_INCOMPLETE: {
    explanation: "Account setup incomplete",
    action: "Finish setting up your merchant account first.",
    severity: "warning",
  },
  UNKNOWN: {
    explanation: "Unknown issue",
    action: "Share this reference with Strivve support.",
    severity: "error",
  },
};
