export type Store = {
  components: ComponentConfig[];
  bugzillaAuth?: BugzillaAuth[] | null;
};

export type ComponentConfig = {
  product: string;
  component: string;
  url: string;
};

export type BugzillaAuth = {
  url: string;
  apiKey: string;
};

export type Bug = {
  id: number;
  summary: string;
  status: string;
  assigned_to: string;
  priority: string;
  severity: string;
  type: string;
  depends_on: number[];
  creator?: string;
  creation_time?: string;
};

export type BugSearchResponse = {
  bugs: Bug[];
};

export type BugFilters = {
  component?: string;
  assigned?: string;
  priority?: string;
  severity?: string;
};

export type BugComment = {
  text: string;
  count: number;
};

export type BugCommentResponse = {
  bugs: Record<string, { comments: BugComment[] }>;
};
