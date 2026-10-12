import type { Meta, StoryObj } from "@storybook/svelte";
import InstitutionSearch from "./InstitutionSearch.svelte";
import type { InstitutionType } from "@openfinance/shared";

const mockInstitutions: InstitutionType[] = [
  {
    id: "1",
    name: "Chase",
    url: "https://www.chase.com",
    primaryColor: "#117ACA",
    logoUrl: null,
    providers: ["plaid", "mx"],
    plaidData: {
      institutionId: "ins_3",
      countryCodes: ["US"],
      oauth: false,
      products: ["transactions", "auth"],
      routingNumbers: ["021000021"],
    },
    mxData: {
      institutionCode: "chase",
      name: "Chase",
    },
  },
  {
    id: "2",
    name: "Bank of America",
    url: "https://www.bankofamerica.com",
    primaryColor: "#E31837",
    logoUrl: null,
    providers: ["plaid"],
    plaidData: {
      institutionId: "ins_1",
      countryCodes: ["US"],
      oauth: false,
      products: ["transactions"],
      routingNumbers: [],
    },
  },
  {
    id: "3",
    name: "Wells Fargo",
    url: "https://www.wellsfargo.com",
    primaryColor: "#D71E28",
    logoUrl: null,
    providers: ["mx"],
    mxData: {
      institutionCode: "wells_fargo",
      name: "Wells Fargo",
    },
  },
  {
    id: "4",
    name: "Citi",
    url: "https://www.citi.com",
    primaryColor: "#003B70",
    logoUrl: null,
    providers: ["plaid", "mx"],
    plaidData: {
      institutionId: "ins_5",
      countryCodes: ["US"],
      oauth: false,
      products: ["transactions", "auth"],
      routingNumbers: [],
      connectionHealth: {
        item_logins: {
          status: "DEGRADED",
          last_status_change: "2024-01-01",
          breakdown: {
            success: 0.75,
            error_institution: 0.2,
            error_plaid: 0.05,
          },
        },
        transactions_updates: {
          status: "HEALTHY",
          last_status_change: "2024-01-01",
          breakdown: {
            success: 0.98,
            error_institution: 0.01,
            error_plaid: 0.01,
          },
        },
        lastUpdated: "2024-01-01",
      },
    },
    mxData: {
      institutionCode: "citi",
      name: "Citi",
    },
  },
  {
    id: "5",
    name: "Capital One",
    url: "https://www.capitalone.com",
    primaryColor: "#004977",
    logoUrl: null,
    providers: ["plaid"],
    plaidData: {
      institutionId: "ins_9",
      countryCodes: ["US"],
      oauth: true,
      products: ["transactions"],
      routingNumbers: [],
    },
  },
];

const meta: Meta = {
  title: "Sync/InstitutionSearch",
  component: InstitutionSearch as any,
  tags: ["autodocs"],
  argTypes: {
    isOpen: { control: "boolean" },
    isSearching: { control: "boolean" },
    searchQuery: { control: "text" },
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  args: {
    isOpen: true,
    institutions: mockInstitutions,
    isSearching: false,
    searchQuery: "",
    connectedInstitutionIds: new Set<string>(),
    onSearchInput: (query: string) => console.log("Search:", query),
    onProviderSelect: (inst: InstitutionType, provider: string) =>
      console.log("Provider:", inst.name, provider),
    onSearchAll: () => console.log("Search all institutions"),
    onClose: () => console.log("Closed"),
  },
};

export const Loading: Story = {
  args: {
    ...Default.args,
    institutions: [],
    isSearching: true,
  },
};

export const WithSearchQuery: Story = {
  args: {
    ...Default.args,
    searchQuery: "chase",
    institutions: mockInstitutions.filter((i) =>
      i.name.toLowerCase().includes("chase"),
    ),
  },
};

export const WithConnectedInstitutions: Story = {
  args: {
    ...Default.args,
    connectedInstitutionIds: new Set(["ins_3", "wells_fargo"]),
  },
};

export const NoResults: Story = {
  args: {
    ...Default.args,
    searchQuery: "nonexistent bank",
    institutions: [],
    isSearching: false,
  },
};
