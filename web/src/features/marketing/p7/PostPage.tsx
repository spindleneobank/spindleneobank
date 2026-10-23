import { type Block, POST_BY_OLD_SLUG, type Post, SHARE_ICONS } from '../../../content/blogs';
import { PostCard } from './BlogsPage';
import { ArrowLink, Edge, Photo, Section } from './parts';

/** Article body shared by blog posts and illustrative flows: h4 / p / inline photos. */
export function Flow({ blocks }: { blocks: Block[] }) {
  return (
    <div className="pg-post-flow">
      {blocks.map((b, i) => {
        const key = `${b.t}-${i}`;
        if (b.t === 'img') return <Photo key={key} img={b} />;
        return b.t === 'h4' ? (
          <h4 key={key} className="pg-h4">
            {b.text}
          </h4>
        ) : (
          <p key={key} className="pg-p">
            {b.text}
          </p>
        );
      })}
    </div>
  );
}

function AsideItem({ head, text }: { head: string; text: string }) {
  return (
    <div>
      <div className="pg-aside-item">
        <div>
          <p className="pg-aside-head">{head}</p>
        </div>
        <div>
          <p className="pg-aside-text">{text}</p>
        </div>
      </div>
    </div>
  );
}

/** A blog post: hero image, title, article with meta aside, and three related posts. */
export function PostPage({ post }: { post: Post }) {
  return (
    <>
      <Section className="pg pg-hero pg-post">
        <div className="pg-post-imgband">
          <Edge side="b" />
          <div className="pg-container">
            <div className="pg-post-imgwrap">
              <Photo img={post.hero} className="pg-photo" />
            </div>
          </div>
        </div>
        <div className="pg-post-title">
          <div className="pg-container">
            <div className="pg-post-titlein">
              <div>
                <ArrowLink to="/blogs" label="Back" dir="back" />
              </div>
              <div>
                <h1 className="pg-h1">{post.title}</h1>
              </div>
            </div>
          </div>
        </div>
        <div className="pg-post-bodyband">
          <Edge side="t" />
          <Edge side="b" />
          <div className="pg-container">
            <div className="pg-post-content">
              <Flow blocks={post.body} />
            </div>
            <div className="pg-post-aside">
              <Edge side="l" />
              <AsideItem head="Prepared from" text={post.preparedFrom} />
              <AsideItem head="Category" text={post.asideCategory} />
              <AsideItem head="Date" text={post.date} />
              <div className="pg-aside-block">
                <div>
                  <p className="pg-aside-head">Share this article</p>
                </div>
                <div className="pg-share">
                  {SHARE_ICONS.map((svg) => (
                    <div key={svg} className="pg-share-i">
                      <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: svg }} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </Section>
      <Section className="pg pg-related">
        <div className="pg-related-title">
          <div className="pg-container">
            <div>
              <h2 className="pg-h2">Related posts</h2>
            </div>
            <div>
              <ArrowLink to="/blogs" label="Read all field notes" dir="forward" variant="dark" />
            </div>
          </div>
        </div>
        <div className="pg-bi-grid-band">
          <Edge side="t" />
          <Edge side="b" />
          <div className="pg-container">
            <div className="pg-grid">
              {post.related.map((r) => {
                const p = POST_BY_OLD_SLUG[r.oldSlug];
                return p ? <PostCard key={p.slug} post={p} img={r.img} /> : null;
              })}
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
