let yolo = false;
export const isYolo = () => yolo;
export const toggleYolo = () => {
  yolo = !yolo;
};

let activeAgent = "default";
export const getActiveAgent = () => activeAgent;
export const setActiveAgent = (name: string) => {
  activeAgent = name;
};
