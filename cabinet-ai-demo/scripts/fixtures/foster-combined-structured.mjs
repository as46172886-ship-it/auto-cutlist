import { fosterStorage1Structured } from "./foster-storage1-structured.mjs";
import { fosterStorage2Structured } from "./foster-storage2-structured.mjs";

const storage2 = {
  ...fosterStorage2Structured,
  cabinets: fosterStorage2Structured.cabinets.map((cabinet) => ({
    ...cabinet,
    id: `S2-${cabinet.id}`,
    name: `S2-${cabinet.name}`,
    elevationId: "E02",
    widthChainId: "S2-W01",
  })),
  independentPanels: fosterStorage2Structured.independentPanels.map((panel) => ({
    ...panel, id: `S2-${panel.id}`, elevationId: "E02",
  })),
  kickboards: fosterStorage2Structured.kickboards.map((kickboard) => ({
    ...kickboard, id: `S2-${kickboard.id}`, elevationId: "E02",
  })),
  mirrors: fosterStorage2Structured.mirrors.map((mirror) => ({
    ...mirror, id: `S2-${mirror.id}`, elevationId: "E02",
  })),
  specialHardware: fosterStorage2Structured.specialHardware.map((item) => ({ ...item, elevationId: "E02" })),
};

export const fosterCombinedStructured = {
  cabinets: [...fosterStorage1Structured.cabinets, ...storage2.cabinets],
  independentPanels: [...fosterStorage1Structured.independentPanels, ...storage2.independentPanels],
  kickboards: [...fosterStorage1Structured.kickboards, ...storage2.kickboards],
  mirrors: [...fosterStorage1Structured.mirrors, ...storage2.mirrors],
  specialHardware: [...fosterStorage1Structured.specialHardware, ...storage2.specialHardware],
};
