export const inventory = {
  "eyebrow": "Assess",
  "title": "Inventory",
  "description": "Scan this workspace's Azure resources or import a file. Scans are kept, not overwritten.",
  "actions": {
    analyzeScan: "Analyze this scan",
    "runScan": "Run scan",
    "importFile": "Import file",
    "setUpConnection": "Set up connection",
    "editConnection": "Edit connection",
    "viewInventory": "View inventory",
    "viewProgress": "View progress",
    "starting": "Starting scan.",
    "importing": "Importing the file."
  },
  "importHelp": "Use the JSON output of az graph query for the resources and resourcecontainers tables. Up to 64 MB and 50,000 rows.",
  "connection": {
    "notConnected": "This workspace has no Azure connection. You can still import a file.",
    "summary": "Tenant {tenant} · {count} target subscriptions",
    "summaryOne": "Tenant {tenant} · {count} target subscription",
    "certificateValid": "Certificate valid until {date}",
    "form": {
      "title": "Azure connection",
      "eyebrow": "Workspace · {name}",
      "description": "CloudMaru reads this workspace's Azure resources with an app registration certificate. It only reads and never changes resources.",
      "tenantId": "Tenant ID",
      "clientId": "Application (client) ID",
      "certificatePath": "Certificate file path",
      "certificatePathHelp": "Absolute path to a PEM file that contains the certificate and its private key. Convert a PFX file to PEM first.",
      "passwordEnv": "Password environment variable (optional)",
      "passwordEnvHelp": "If the private key is encrypted, enter the name of the .env.local variable that holds the password. Do not enter the password itself.",
      "subscriptionIds": "Target subscriptions",
      "subscriptionIdsHelp": "One subscription ID per line, up to 50.",
      "save": "Save connection",
      "saving": "Saving.",
      "saved": "Connection saved.",
      "remove": "Remove connection",
      "removed": "Connection removed.",
      "backToWorkspaces": "Back to workspaces",
      "goToInventory": "Go to inventory",
      "errors": {
        "tenant-id-invalid": "Enter the tenant ID as a GUID.",
        "client-id-invalid": "Enter the application ID as a GUID.",
        "certificate-path-invalid": "Enter an absolute path that starts with /.",
        "password-env-invalid": "Use 3 to 64 capital letters, numbers, and underscores, starting with a letter.",
        "subscriptions-invalid": "Enter 1 to 50 subscription IDs as GUIDs, one per line.",
        "save": "Could not save. Try again."
      }
    }
  },
  "scanRunning": "A scan is running.",
  "latest": {
    "title": "Latest scan",
    "collected": "Collected {date} · {source}"
  },
  "source": {
    "live": "Direct connection",
    "import": "File"
  },
  "summary": {
    "resources": "Resources",
    "subscriptions": "Subscriptions",
    "resourceGroups": "Resource groups",
    "regions": "Regions",
    "untagged": "Without tags",
    "unread": "{count} subscriptions returned no resources. The app may not have the Reader role on them.",
    "unreadOne": "{count} subscription returned no resources. The app may not have the Reader role on it.",
    "unreadTitle": "Subscriptions not read",
    "skipped": "{count} rows could not be read and were skipped.",
    "skippedOne": "{count} row could not be read and was skipped."
  },
  "history": {
    "title": "Scan history",
    "empty": "No scans yet.",
    "date": "Date",
    "source": "Source",
    "status": "Status",
    "resources": "Resources"
  },
  "status": {
    "pending": "Scanning",
    "succeeded": "Completed",
    "failed": "Failed"
  },
  "pending": {
    "message": "Scanning. This usually takes a few minutes.",
    "longRunning": "This is taking longer than usual.",
    "explanation": "CloudMaru reads the target subscriptions with Azure Resource Graph. It only reads and never changes resources.",
    "leave": "You can leave this page. The scan continues and appears in scan history.",
    "progress": "Scan in progress",
    "elapsed": "Elapsed time",
    "stalled": "Could not check the scan status. Try again."
  },
  "failed": {
    "otherWorkspace": "Switch to this scan's workspace to run it again."
  },
  "detail": {
    "eyebrow": "Scan · {date}",
    "otherWorkspace": "This scan belongs to {name}, not the current workspace.",
    "families": "By family",
    "familyCount": "{count} resources",
    "familyCountOne": "{count} resource"
  },
  "stages": {
    "source": "Source",
    "ingest": "Ingest",
    "process": "Process",
    "store": "Store",
    "serve": "Serve",
    "infra": "Infrastructure",
    "unclassified": "Unclassified"
  },
  "families": {
    "static-web": "Static web apps",
    "cdn": "CDN and Front Door",
    "web-app": "Web apps",
    "app-plan": "App Service plans",
    "sql-managed-instance": "SQL managed instances",
    "sql-server": "SQL servers",
    "sql-database": "SQL databases",
    "synapse-workspace": "Synapse workspaces",
    "synapse-pool": "Synapse pools",
    "storage": "Storage accounts",
    "cosmos": "Cosmos DB",
    "data-factory": "Data Factory",
    "databricks": "Databricks",
    "messaging": "Messaging",
    "compute": "Virtual machines",
    "container-compute": "Containers",
    "analysis-services": "Analysis Services",
    "machine-learning": "Machine learning",
    "key-vault": "Key Vault",
    "monitoring": "Monitoring",
    "network": "Networking",
    "certificate": "Certificates",
    "other": "Other"
  },
  "table": {
    "title": "Resources",
    "search": "Search by name or resource ID",
    "type": "Resource type",
    "allTypes": "All types",
    "apply": "Apply",
    "name": "Name",
    "resourceGroup": "Resource group",
    "region": "Region",
    "subscription": "Subscription",
    "tags": "Tags",
    "noTags": "No tags",
    "tagCount": "{count} tags",
    "tagCountOne": "{count} tag",
    "noRegion": "—",
    "matched": "Showing {from}–{to} of {matched} resources",
    "matchedOne": "Showing {from}–{to} of {matched} resource",
    "noMatch": "No resources match. Change the search or type.",
    "previous": "Previous page",
    "next": "Next page",
    "page": "Page {page} of {pages}"
  },
  "titles": {
    "inventory": "Inventory",
    "scan": "Scan inventory",
    "scanPending": "Scanning",
    "scanFailed": "Scan failed",
    "scanNotFound": "Scan not found",
    "connection": "Azure connection"
  },
  "notFound": {
    "title": "Scan not found",
    "description": "The scan may have been removed, or the link may be wrong."
  },
  "errors": {
    "scan": {
      "connection-missing": "This workspace has no Azure connection or target subscription. Set up the connection first.",
      "certificate-not-found": "The certificate file could not be read. Check the file path and read permission.",
      "certificate-invalid": "The file is not a PEM file with both the certificate and its private key. If it is a PFX file, convert it to PEM.",
      "certificate-expired": "The certificate has expired. Add a new certificate to the app registration and update the file path.",
      "certificate-password-missing": "The private key needs a password, but its environment variable is not set. Set it in .env.local.",
      "auth-failed": "Azure did not issue a token. Check the tenant ID, application ID, and the certificate registered on the app.",
      "forbidden": "The app is not allowed to read these subscriptions. Assign the Reader role and try again.",
      "subscription-not-found": "A target subscription was not found. Check the subscription IDs.",
      "throttled": "Azure limited the request rate. Wait a few minutes and try again.",
      "timeout": "The scan did not finish within 10 minutes. Try again or scan fewer subscriptions.",
      "too-many-rows": "The scan returned more than 50,000 rows. Scan fewer subscriptions.",
      "invalid-response": "Azure returned a response CloudMaru could not read. Try again.",
      "interrupted": "The scan stopped before it finished, for example because the server restarted. Run the scan again.",
      "internal": "The scan could not be completed. Try again."
    },
    "api": {
      "invalid-body": "The request could not be read. Reload the page and try again.",
      "workspace-changed": "The workspace was changed in another tab. Reload the page and try again.",
      "connection-missing": "This workspace has no Azure connection or target subscription. Set up the connection first.",
      "import-invalid": "The file is not a supported inventory format. Export the Resource Graph results as JSON and try again.",
      "import-too-many-rows": "The file has more than 50,000 rows. Split it by subscription.",
      "import-empty": "The file has no resources. Check that it includes the resources table.",
      "import-too-large": "The file is larger than 64 MB. Split it by subscription.",
      "not-found": "The scan was not found.",
      "internal": "Something went wrong. Try again."
    }
  }
} as const;
