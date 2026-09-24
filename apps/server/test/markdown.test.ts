import { describe, expect, it } from "vitest";
import { htmlToMarkdown, markdownToHtml } from "../src/core/markdown";

describe("markdown <-> editor html", () => {
  it("renders agent markdown, including task lists, and escapes raw html", () => {
    const html = markdownToHtml("## Plan\n\n- [ ] write tests\n- [x] ship\n\nSee **APP-12** <script>alert(1)</script>");
    expect(html).toContain("<h2>Plan</h2>");
    expect(html).toContain('<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>write tests</p></li>');
    expect(html).toContain('data-checked="true"><p>ship</p>');
    expect(html).not.toContain("<script>");
  });

  it("turns editor html back into markdown for agents", () => {
    const md = htmlToMarkdown(
      '<h2>Plan</h2><p>Ask <span data-type="mention" data-id="x" data-label="Priya">@Priya</span></p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked></label><div><p>ship</p></div></li></ul>',
    );
    expect(md).toContain("## Plan");
    expect(md).toContain("Ask @Priya");
    expect(md).toContain("- [x] ship");
  });
});
