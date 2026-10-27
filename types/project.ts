export type ProjectRecord = {
  id: string;
  name: string;
  createdAt: string;
};

export type FileDiff = {
  before: string;
  after: string;
  added: number;
  removed: number;
};
