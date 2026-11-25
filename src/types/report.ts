import type { ReportSection as EvidenceSection } from "@/lib/assessment/report/document";
import type { ReportSelection, SectionId } from "@/lib/report/selection";
/** Stored labels of the saved record's owning workspace, read by its saved ID at report time. */
export type ReportOwner = {
    workspaceId: string;
    name: string;
    companyName: string | null;
};
export type ReportTable = {
    headers: string[];
    rows: string[][];
};
export type ReportSection = {
    id: SectionId;
    title: string;
    paragraphs: string[];
    table?: ReportTable;
};
export type ConsultingReport = {
    kind: "assess" | "build" | "extend";
    id: string;
    workspaceId: string;
    owner: ReportOwner;
    title: string;
    subject: string;
    createdAt: string;
    selection: ReportSelection;
    total: number;
    included: number;
    partial: boolean;
    limits: string[];
    metrics: {
        label: string;
        value: string;
        note?: string;
    }[];
    chart?: {
        title: string;
        total: number;
        rows: {
            label: string;
            value: number;
            tone: "danger" | "caution" | "success";
        }[];
    };
    sections: ReportSection[];
    appendix: EvidenceSection[];
    details?: ReportSection[];
};
