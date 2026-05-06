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
  type: string;
};

export type BugSearchResponse = {
  bugs: Bug[];
};
