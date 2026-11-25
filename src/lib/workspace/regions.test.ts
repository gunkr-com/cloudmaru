import { expect, it } from "vitest";
import { regionLabel, STATIC_WEB_APPS_LOCATION, DEFAULT_REGION, isSupportedRegion, SUPPORTED_REGIONS } from "./regions";
it("supports the three priced regions with Canada Central as default", () => {
  expect(SUPPORTED_REGIONS).toEqual([
    { id: "canadacentral", label: "Canada Central" },
    { id: "westus2", label: "West US 2" },
    { id: "centralus", label: "Central US" },
  ]);
  expect(DEFAULT_REGION).toBe("canadacentral");
  expect(isSupportedRegion("canadaeast")).toBe(false);
  for (const region of SUPPORTED_REGIONS) expect(isSupportedRegion(region.id)).toBe(true);
  for (const id of ["", "Canada Central", "CANADACENTRAL", "koreacentral", "global"]) expect(isSupportedRegion(id)).toBe(false);
});

it("labels known regions and preserves unknown IDs", () => {
  expect(regionLabel("canadacentral")).toBe("Canada Central");
  expect(regionLabel("westus2")).toBe("West US 2");
  expect(regionLabel("centralus")).toBe("Central US");
  expect(regionLabel("unknown")).toBe("unknown");
  expect(STATIC_WEB_APPS_LOCATION).toBe("eastus2");
});
