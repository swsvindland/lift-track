// Optional kit route (vector-kit sync --include src/app/vector-gallery.tsx): the dev-only kit gallery where the
// simulator review runs. Never linked; production builds redirect home.
import type { ComponentType } from "react";
import { Redirect } from "expo-router";

function Home() {
  return <Redirect href="/" />;
}

// A require inside __DEV__, not an import: Metro folds __DEV__ to false in production and drops the branch, so the
// gallery (sample series, English sample text) never reaches a release bundle.
const Gallery: ComponentType = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require("@/vector/gallery") as typeof import("@/vector/gallery")).VectorGallery
  : Home;

export default Gallery;
