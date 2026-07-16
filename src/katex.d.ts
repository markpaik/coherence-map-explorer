// KaTeX auto-render has no bundled types for the subpath export, and Vite lets
// us import the stylesheet as a side-effect module. Declare just what we use.
declare module "katex/contrib/auto-render" {
  interface AutoRenderOptions {
    delimiters?: { left: string; right: string; display: boolean }[];
    throwOnError?: boolean;
    errorColor?: string;
    ignoredTags?: string[];
    ignoredClasses?: string[];
  }
  const renderMathInElement: (el: HTMLElement, options?: AutoRenderOptions) => void;
  export default renderMathInElement;
}

declare module "katex/dist/katex.min.css";
