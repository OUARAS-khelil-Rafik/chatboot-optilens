import ChatUI from "@/components/ChatUI";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function Home(props: { searchParams?: SearchParams | Promise<SearchParams> }) {
  const searchParams = await Promise.resolve(props.searchParams);
  const embedParam = searchParams?.embed;
  const embed = Array.isArray(embedParam) ? embedParam[0] === "1" : embedParam === "1";

  return (
    <div className={embed ? "min-h-screen bg-white p-4" : "min-h-screen bg-white p-6"}>
      <ChatUI embed={embed} />
    </div>
  );
}
