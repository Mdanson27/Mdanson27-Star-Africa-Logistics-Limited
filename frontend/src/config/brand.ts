export const brand = {
  companyName: "Star Africa Logistics",
  legalName: "Star Africa Logistics Limited",
  shortName: "Star Africa",
  productName: "Star Africa Logistics Operating System",
  workspaceName: "Star Africa Logistics OS",
  domain: "starafricalogistics.com",
  emails: {
    info: "info@starafricalogistics.com",
    operations: "operations@starafricalogistics.com",
    director: "director@starafricalogistics.com",
  },
  administratorPhone: "+256787132332",
  poweredBy: "AutoMinds Africa",
  assets: {
    logo: "branding/star-africa-logo.png",
    compactLogo: "branding/star-africa-logo-compact.png",
    mark: "branding/star-africa-mark.png",
  },
} as const;

export const brandAsset = (path: string) => `${import.meta.env.BASE_URL}${path}`;
