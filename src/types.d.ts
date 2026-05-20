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
  assigned_to_detail?: { real_name: string; name: string; id: number };
  priority: string;
  severity: string;
  type: string;
  depends_on: number[];
  groups?: string[];
  creator?: string;
  creation_time?: string;
  last_change_time?: string;
};

export type BugSearchResponse = {
  bugs: Bug[];
};

export type BugFilters = {
  component?: string;
  assigned?: string;
  priority?: string;
  severity?: string;
  sort?: string[];
  active?: boolean;
};

export type ComponentBugsData = {
  product: string;
  component: string;
  url: string;
  totalFetched: number;
  bugs: Bug[];
  active?: Bug[];
  stale?: Bug[];
};

export type BugComment = {
  text: string;
  count: number;
};

export type BugCommentResponse = {
  bugs: Record<string, { comments: BugComment[] }>;
};
