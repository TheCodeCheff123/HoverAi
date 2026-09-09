export interface Tool {
  name: string;
  logo: string;
}

const images = import.meta.glob(
  "../../assets/images/tools/*.png",
  {
    eager: true,
    import: "default",
    query: "?url",
  }
);

function formatToolName(filename: string): string {
  return filename
    .replace(".png", "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export const TOOLS: Tool[] = Object.entries(images)
  .map(([path, logo]) => {
    const filename = path.split("/").pop()!;

    return {
      name: formatToolName(filename),
      logo: logo as string,
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));
  