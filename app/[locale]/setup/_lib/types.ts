export type SetupMode = "oauth" | "serviceAccount";

export type OAuthFormData = {
  clientId: string;
  clientSecret: string;
  rootFolderId: string;
  authCode: string;
};

export type ServiceAccountFormData = {
  clientId: string;
  clientSecret: string;
  serviceAccountEmail: string;
  serviceAccountKey: string;
  rootFolderId: string;
};
