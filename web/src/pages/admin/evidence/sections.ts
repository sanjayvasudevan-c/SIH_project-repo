import type { ComponentType } from 'react';
import { AlertsSection } from './sections/alerts';
import { AssignmentSection } from './sections/assignment';
import { AuditSection } from './sections/audit';
import { MlSection } from './sections/ml';
import { OverviewSection } from './sections/overview';
import { PerformanceSection } from './sections/performance';
import { SchedulerSection } from './sections/scheduler';
import { WorkflowSection } from './sections/workflow';

export type SectionId = 'overview' | 'workflow' | 'assignment' | 'scheduler' | 'alerts' | 'audit' | 'ml' | 'performance';

export interface SectionDef {
  id: SectionId;
  label: string;
  description: string;
  Component: ComponentType;
}

export const SECTIONS: SectionDef[] = [
  { id: 'overview', label: 'Overview', description: 'The headline figures, each linking to the section that explains it.', Component: OverviewSection },
  { id: 'workflow', label: 'Workflow', description: 'How applications move through the approval stages and where they are overdue.', Component: WorkflowSection },
  { id: 'assignment', label: 'Assignment', description: 'How cases are assigned to officers, with the stored reason for each decision.', Component: AssignmentSection },
  { id: 'scheduler', label: 'Scheduler & compliance', description: 'What the deadline engine ran, what it created and suppressed, and what colleges owe.', Component: SchedulerSection },
  { id: 'alerts', label: 'Alerts', description: 'The alerts the system raised and what is and is not recorded about them.', Component: AlertsSection },
  { id: 'audit', label: 'Audit', description: 'What the audit log records, in counts, and its integrity check.', Component: AuditSection },
  { id: 'ml', label: 'ML evaluation', description: 'How the form-check model performs on its synthetic evaluation data.', Component: MlSection },
  { id: 'performance', label: 'Performance', description: 'Benchmark timings and the machine they were measured on.', Component: PerformanceSection },
];

export const isSectionId = (s: string | undefined): s is SectionId => SECTIONS.some((x) => x.id === s);
