"""Verify private synthetic HTML reports have inert accessible structure."""
from html.parser import HTMLParser
from pathlib import Path
import sys

class ReviewParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tags = []
        self.h1 = 0
        self.checks = []
    def handle_starttag(self, tag, attrs):
        self.tags.append(tag)
        if tag == "h1":
            self.h1 += 1
        if tag in ("script","iframe","object","embed","form","input","button","textarea","select","a"):
            raise AssertionError(f"Active control forbidden in offline review: {tag}")
        if any(k.lower().startswith("on") for k, _ in attrs):
            raise AssertionError("Script event handler forbidden in offline review")
    def handle_data(self, data):
        if data.strip():
            self.checks.append(data)

def main(directory):
    for company in ("painting","cleaning","painting-unicode","painting-v4"):
        path = directory / f"{company}.review.html"
        text = path.read_text(encoding="utf-8")
        parser = ReviewParser()
        parser.feed(text)
        content = " ".join(parser.checks)
        assert parser.h1 == 1 and "main" in parser.tags and "table" in parser.tags
        for required in ("BLOCKED - SYNTHETIC INTERNAL DRAFT - NOT FOR DELIVERY",
                         "NOT RUN", "PASSED", "Pricing policy",
                         "PDF integrity", "No authenticated operator",
                         "Source and scope", "Assumptions", "Exclusions"):
            assert required in content, f"{company}: missing {required}"
        assert text.count('<th scope="col">') >= 6
        if company == "painting-v4":
            for required in ("Changes since revision 3", "Prior revision receipts",
                             "1,020.00", "1,045.00", "Prepare and repaint newly measured"):
                assert required in content, f"Revision comparison missing {required}"
        print("PASS: inert offline proposal report:", company)

if __name__ == "__main__":
    if len(sys.argv)!=2: raise SystemExit("Usage: proposal_review_markup_qa.py <directory>")
    main(Path(sys.argv[1]))
