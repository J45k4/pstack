declare module "*.svg" {
  const path: `${string}.svg`;
  export default path;
}

declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}
