/** @type {import("orval").Config} */
module.exports = {
  zeeIndexApi: {
    input: {
      target: "./docs/api/openapi.yaml",
    },
    output: {
      mode: "single",
      target: "./packages/sdk/src/orval/index.ts",
      client: "fetch",
      clean: true,
      prettier: false,
      override: {
        operations: {
          uploadToFileRequest: {
            mutator: {
              path: "./packages/sdk/src/mixed-upload-fetch.ts",
              name: "mixedUploadFetch",
            },
          },
          uploadFile: {
            mutator: {
              path: "./packages/sdk/src/mixed-upload-fetch.ts",
              name: "mixedUploadFetch",
            },
          },
        },
      },
    },
  },
};
