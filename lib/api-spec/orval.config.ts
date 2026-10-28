import { defineConfig, InputTransformerFn } from "orval";
import path from "path";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

// Merge local source fragments before Orval parses them. Cloning also prevents
// shared YAML anchors from being rewritten repeatedly by the external-ref parser.
const foundation = parse(readFileSync(path.join(__dirname, "openapi.yaml"), "utf8"));
const lms = parse(readFileSync(path.join(__dirname, "lms.yaml"), "utf8"));
const media = parse(readFileSync(path.join(__dirname, "media.yaml"), "utf8"));
const library = parse(readFileSync(path.join(__dirname, "media-library.yaml"), "utf8"));
const processing = parse(readFileSync(path.join(__dirname, "media-processing.yaml"), "utf8"));
const renditions = parse(readFileSync(path.join(__dirname, "media-renditions.yaml"), "utf8"));
const assessments = parse(readFileSync(path.join(__dirname, "assessments.yaml"), "utf8"));
const questionBank = parse(readFileSync(path.join(__dirname, "question-bank.yaml"), "utf8"));
const quizzes = parse(readFileSync(path.join(__dirname, "quiz-composition.yaml"), "utf8"));
const attempts = parse(readFileSync(path.join(__dirname, "assessment-attempts.yaml"), "utf8"));
const contract = () => JSON.parse(JSON.stringify({
  ...foundation,
  paths: {
    ...Object.fromEntries(Object.entries(foundation.paths).filter(([, operation]) => !(operation as { $ref?: string }).$ref)),
    ...Object.fromEntries(Object.entries(lms.paths).map(([route, operation]) => [`/v1${route}`, operation])),
    ...Object.fromEntries(Object.entries(media.paths).map(([route, operation]) => [`/v1${route}`, operation])),
    ...Object.fromEntries(Object.entries(library.paths).map(([route, operation]) => [`/v1${route}`, operation])),
    ...Object.fromEntries(Object.entries(processing.paths).map(([route, operation]) => [`/v1${route}`, operation])),
    ...Object.fromEntries(Object.entries(renditions.paths).map(([route, operation]) => [`/v1${route}`, operation])),
    ...Object.fromEntries(Object.entries(questionBank.paths).map(([route, operation]) => [`/v1${route}`, operation])),
    ...Object.fromEntries(Object.entries(quizzes.paths).map(([route, operation]) => [`/v1${route}`, operation])),
    ...Object.fromEntries(Object.entries(attempts.paths).map(([route, operation]) => [`/v1${route}`, operation])),
  },
  components: {
    ...foundation.components,
    schemas: { ...foundation.components.schemas, ...lms.components.schemas, ...media.components.schemas, ...library.components.schemas, ...processing.components.schemas, ...renditions.components.schemas, ...assessments.components.schemas, ...questionBank.components.schemas, ...quizzes.components.schemas, ...attempts.components.schemas },
    parameters: { ...foundation.components.parameters, ...lms.components.parameters, ...media.components.parameters, ...library.components.parameters, ...processing.components.parameters, ...renditions.components.parameters, ...questionBank.components.parameters, ...quizzes.components.parameters, ...attempts.components.parameters },
    responses: { ...foundation.components.responses, ...lms.components.responses, ...media.components.responses, ...library.components.responses, ...processing.components.responses, ...renditions.components.responses, ...questionBank.components.responses, ...quizzes.components.responses, ...attempts.components.responses },
  },
  // These two schema fragments are already merged above. Keep the source Q4
  // fragment independently resolvable, without enabling arbitrary external refs.
}), (key, value) => key === "$ref" && typeof value === "string"
  ? value.replace(/^\.\/(?:assessments|question-bank)\.yaml#/, "#") : value);

const root = path.resolve(__dirname, "..", "..");
const apiClientReactSrc = path.resolve(root, "lib", "api-client-react", "src");
const apiZodSrc = path.resolve(root, "lib", "api-zod", "src");

// Our exports make assumptions about the title of the API being "Api" (i.e. generated output is `api.ts`).
const titleTransformer: InputTransformerFn = (config) => {
  config.info ??= {};
  config.info.title = "Api";

  return config;
};

export default defineConfig({
  // Orval's operation-oriented Zod output omits unreferenced runtime schemas.
  // Emit the schemas-only Q2 fragment separately; no invented operation is needed.
  "assessment-zod": {
    input: { target: JSON.parse(JSON.stringify(assessments)) },
    output: {
      target: path.resolve(apiZodSrc, "assessment-contracts.ts"),
      client: "zod",
      mode: "single",
      prettier: true,
      override: { zod: { version: 3, generateReusableSchemas: true } },
    },
  },
  "api-client-react": {
    input: {
      target: contract(),
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiClientReactSrc,
      target: "generated",
      client: "react-query",
      mode: "split",
      baseUrl: "/api",
      clean: true,
      prettier: true,
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          path: path.resolve(apiClientReactSrc, "custom-fetch.ts"),
          name: "customFetch",
        },
      },
    },
  },
  zod: {
    input: {
      target: contract(),
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiZodSrc,
      client: "zod",
      target: "generated",
      schemas: { path: "generated/types", type: "typescript" },
      mode: "split",
      clean: true,
      prettier: true,
      override: {
        zod: {
          // Orval resolves `auto` from lib/api-spec/package.json, which has no
          // zod dependency, so orval >= 8.23 falls back to Zod 4 syntax while
          // the catalog installs zod 3. Pin to match the catalog.
          version: 3,
          coerce: {
            query: ['boolean', 'number', 'string'],
            param: ['boolean', 'number', 'string'],
            body: ['bigint', 'date'],
            response: ['bigint', 'date'],
          },
        },
        useDates: true,
        useBigInt: true,
      },
    },
  },
});
