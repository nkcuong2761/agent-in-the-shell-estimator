import type { ProjectType } from '@scopewise/shared';

const LABELS: Record<ProjectType, string> = {
  'new-feature': 'New feature',
  'form-digitization': 'Form',
  integration: 'Integration',
  'data-migration': 'Data migration',
  reporting: 'Reporting',
};

/** The short category label used on the Home table, the estimate header, the project page and the sidebar. */
export function categoryLabel(type: ProjectType | string | undefined): string {
  return (type && (LABELS as Record<string, string>)[type]) || 'Uncategorised';
}

/** "integrations", "form projects": the plural used in "Default team for integrations". */
export function categoryPlural(type: ProjectType | string | undefined): string {
  const words: Record<string, string> = {
    'new-feature': 'new features',
    'form-digitization': 'form projects',
    integration: 'integrations',
    'data-migration': 'data migrations',
    reporting: 'reporting projects',
  };
  return (type && words[type]) || 'uncategorised projects';
}

/** "integration estimate", "form estimate". */
export function categoryAdjective(type: ProjectType | string | undefined): string {
  return categoryLabel(type).toLowerCase();
}

export const PROJECT_TYPES: ProjectType[] = ['new-feature', 'form-digitization', 'integration', 'data-migration', 'reporting'];
