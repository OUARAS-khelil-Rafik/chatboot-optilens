import ChatUI from "@/components/ChatUI";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function Home(props: { searchParams?: SearchParams | Promise<SearchParams> }) {
  const searchParams = await Promise.resolve(props.searchParams);
  const embedParam = searchParams?.embed;
  const embed = Array.isArray(embedParam) ? embedParam[0] === "1" : embedParam === "1";

  return (
    <div
      className={
        embed
          ? "ol-page-embed p-4"
          : "ol-page p-6"
      }
    >
      {embed ? null : (
        <div className="pointer-events-none fixed inset-0 -z-10">
          <div className="ol-float absolute -top-24 left-[-8rem] h-72 w-72 rounded-full bg-sky-200/40 blur-3xl" />
          <div className="ol-float ol-float-2 absolute -top-16 right-[-6rem] h-72 w-72 rounded-full bg-violet-200/40 blur-3xl" />
          <div className="ol-float ol-float-3 absolute bottom-[-10rem] left-1/3 h-96 w-96 rounded-full bg-emerald-200/30 blur-3xl" />
        </div>
      )}
      <ChatUI embed={embed} />
    </div>
  );
}
