"""
Zero-Dependency Pure-Python PDF Generator for Sample CS & Calculus Slides and Textbook Chapters.
Generates real PDF files in samples/ showcasing Algorithms, Asymptotic Complexity, Recurrences,
Graph Theory, Pseudocode, Limits, Derivatives (Chain/Quotient Rule), Integrals (FTC), and Series.
"""
import os


def escape_pdf_text(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def build_pdf(pages_spec: list[dict], out_path: str) -> None:
    objects: list[bytes] = []

    def add_obj(content: bytes) -> int:
        objects.append(content)
        return len(objects)

    add_obj(b"<< /Type /Catalog /Pages 2 0 R >>")
    add_obj(b"")
    font_reg_id = add_obj(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    font_bold_id = add_obj(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")

    page_ids = []
    for p in pages_spec:
        w, h = p["width"], p["height"]
        cmds = []
        for x, y, size, is_bold, text in p["lines"]:
            font_tag = "/F2" if is_bold else "/F1"
            esc = escape_pdf_text(text)
            cmds.append(f"BT {font_tag} {size} Tf 1 0 0 1 {x} {y} Tm ({esc}) Tj ET")
        stream_bytes = "\n".join(cmds).encode("latin-1", errors="ignore")
        content_id = add_obj(
            f"<< /Length {len(stream_bytes)} >>\nstream\n".encode("ascii") + stream_bytes + b"\nendstream"
        )
        page_dict = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {w} {h}] "
            f"/Resources << /Font << /F1 {font_reg_id} 0 R /F2 {font_bold_id} 0 R >> >> "
            f"/Contents {content_id} 0 R >>"
        ).encode("ascii")
        page_ids.append(add_obj(page_dict))

    kids_str = " ".join(f"{pid} 0 R" for pid in page_ids)
    objects[1] = f"<< /Type /Pages /Kids [{kids_str}] /Count {len(page_ids)} >>".encode("ascii")

    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for idx, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out.extend(f"{idx} 0 obj\n".encode("ascii") + obj + b"\nendobj\n")

    xref_pos = len(out)
    out.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode("ascii"))
    for off in offsets[1:]:
        out.extend(f"{off:010d} 00000 n \n".encode("ascii"))
    out.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode("ascii")
    )
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(out)


def flow_page(rows: list[tuple[int, int, bool, int, str]]) -> dict:
    """rows: [(x, size, is_bold, gap_before, text), ...] laid out top-down on a 612x792 page."""
    y = 742
    lines = []
    for x, size, is_bold, gap, text in rows:
        y -= gap
        lines.append((x, y, size, is_bold, text))
    return {"width": 612, "height": 792, "lines": lines}


def generate_samples(root_dir: str) -> None:
    slides_pages = [
        {
            "width": 960,
            "height": 540,
            "lines": [
                (56, 468, 25, True, "Divide-and-Conquer Sorting and Recurrences"),
                (78, 402, 16, False, "- Merge Sort: Divide-and-conquer sort that merges sorted halves in $O(n \\log n)$ worst-case time."),
                (78, 354, 16, False, "- Recurrence for Merge Sort: $T(n) = 2T(n/2) + O(n)$"),
                (78, 306, 16, False, "- Heapsort: In-place comparison sort using a binary max-heap in $O(n \\log n)$ time and $O(1)$ space."),
                (78, 258, 16, False, "- Quicksort: Partition-based sort running in $O(n \\log n)$ expected time under random pivots."),
                (78, 210, 16, False, "- Partition balance increases when randomized pivot selection decreases worst-case $O(n^{2})$ splits."),
            ],
        },
        {
            "width": 960,
            "height": 540,
            "lines": [
                (56, 468, 25, True, "Binary Search, Asymptotic Bounds, and Pseudocode"),
                (78, 402, 16, False, "- Binary Search: Halves a sorted search interval each iteration in $O(\\log n)$ worst-case time."),
                (78, 354, 16, False, "- Big-O Bound: Function $f(n)$ is $O(g(n))$ when $|f(n)| \\le c|g(n)|$ for all $n \\ge n_{0}$."),
                (78, 306, 16, False, "- Big-Theta Bound: Tight asymptotic bound where $f(n)$ is bounded above and below by $g(n)$."),
                (78, 258, 16, False, "- Loop Invariant: Subarray A[low..high] contains target whenever target exists in sorted array A."),
                (78, 210, 16, False, "- Binary Search Step: Compute midpoint m = (low + high) // 2 and compare A[m] against key."),
            ],
        },
        {
            "width": 960,
            "height": 540,
            "lines": [
                (56, 468, 25, True, "Graph Algorithms and Shortest-Path Complexity"),
                (78, 402, 16, False, "- Breadth-First Search: Explores vertices level by level from a source in $O(V + E)$ time via a queue."),
                (78, 354, 16, False, "- Depth-First Search: Recursively explores incident edges to classify tree, back, and cross edges."),
                (78, 306, 16, False, "- Dijkstra Algorithm: Computes nonnegative single-source shortest paths in $O((V + E) \\log V)$ time."),
                (78, 258, 16, False, "- Topological Sort: Linear ordering of vertices in a directed acyclic graph respecting all edge directions."),
            ],
        },
        {
            "width": 960,
            "height": 540,
            "lines": [
                (56, 468, 25, True, "Calculus Rules for Continuous Optimization"),
                (78, 402, 16, False, "- Quotient Rule: $\\frac{d}{dx}\\left[\\frac{f(x)}{g(x)}\\right] = \\frac{g(x)f'(x) - f(x)g'(x)}{[g(x)]^{2}}$"),
                (78, 354, 16, False, "- Chain Rule: Differentiates composite functions via $\\frac{d}{dx}[f(g(x))] = f'(g(x)) \\cdot g'(x)$."),
                (78, 306, 16, False, "- Fundamental Theorem: Evaluates definite integrals via $\\int_{a}^{b} f(x)\\,dx = F(b) - F(a)$."),
                (78, 258, 16, False, "- Gradient Descent: Updates parameters via $x_{k+1} = x_{k} - \\alpha \\nabla f(x_{k})$ along steepest descent."),
            ],
        },
    ]
    build_pdf(slides_pages, os.path.join(root_dir, "samples", "sample_class_slides.pdf"))

    book_pages = [
        flow_page([
            (72, 18, True, 20, "CHAPTER 1: Limits, Continuity, and Differentiation"),
            (72, 13, True, 28, "1.1 Limits and the Squeeze Theorem"),
            (72, 10.5, False, 20, "A limit describes the value that a function $f(x)$ approaches as the input $x$ approaches $c$."),
            (72, 10.5, False, 15, "Continuity is defined as the property where $\\lim_{x \\to c} f(x) = f(c)$ holds at an interior point $c$."),
            (72, 10.5, False, 15, "Indeterminate Form: A limit ratio such as $\\frac{0}{0}$ whose limiting value requires algebraic simplification."),
            (86, 11, True, 24, "THEOREM 1.1 The Squeeze Theorem"),
            (86, 10.5, False, 16, "If $h(x) \\le f(x) \\le g(x)$ for all $x$ in an open interval containing $c$ except possibly at $c$ itself,"),
            (86, 10.5, False, 15, "and if $\\lim_{x \\to c} h(x) = L = \\lim_{x \\to c} g(x)$, then $\\lim_{x \\to c} f(x) = L$."),
            (72, 10.5, False, 24, "Special trigonometric limit: $\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1$ underpins trigonometric differentiation."),
            (72, 13, True, 26, "1.2 Differentiation, Chain Rule, and Quotient Rule"),
            (72, 10.5, False, 20, "The derivative of a function $f$ at $x$ is given by $f'(x) = \\lim_{h \\to 0} \\frac{f(x + h) - f(x)}{h}$."),
            (72, 10.5, False, 15, "The Quotient Rule: $\\frac{d}{dx}\\left[\\frac{f(x)}{g(x)}\\right] = \\frac{g(x)f'(x) - f(x)g'(x)}{[g(x)]^{2}}$"),
            (72, 10.5, False, 15, "The Chain Rule states that if $y = f(u)$ and $u = g(x)$ are differentiable, then $\\frac{dy}{dx} = f'(g(x))g'(x)$."),
            (72, 10.5, False, 15, "The derivative of $\\tan x$ is $\\sec^{2} x$."),
            (72, 10.5, False, 15, "The derivative of $\\ln x$ is $\\frac{1}{x}$."),
            (72, 10.5, False, 15, "When the derivative $f'(x)$ is positive on an open interval, the function $f$ increases across that interval."),
        ]),
        flow_page([
            (72, 18, True, 20, "CHAPTER 2: Definite Integrals and Infinite Series"),
            (72, 13, True, 28, "2.1 Riemann Sums and the Fundamental Theorem of Calculus"),
            (72, 10.5, False, 20, "Riemann Sum is defined as a finite approximation $\\sum_{i=1}^{n} f(c_{i})\\,\\Delta x_{i}$ over a partition of $[a, b]$."),
            (72, 10.5, False, 15, "Antiderivative refers to a differentiable function $F$ satisfying $F'(x) = f(x)$ across an interval."),
            (86, 11, True, 24, "THEOREM 2.1 The Fundamental Theorem of Calculus"),
            (86, 10.5, False, 16, "If a function $f$ is continuous on the closed interval $[a, b]$ and $F$ is an antiderivative of $f$ on $[a, b]$,"),
            (86, 10.5, False, 15, "then $\\int_{a}^{b} f(x)\\,dx = F(b) - F(a)$."),
            (72, 10.5, False, 24, "Integration by Parts Formula: $\\int u\\,dv = uv - \\int v\\,du$"),
            (72, 13, True, 26, "2.2 Convergence of Geometric and Taylor Series"),
            (72, 10.5, False, 20, "Geometric Series: An infinite series $\\sum_{n=0}^{\\infty} ar^{n}$ with nonzero first term $a$ and common ratio $r$."),
            (86, 11, True, 24, "THEOREM 2.2 Convergence of a Geometric Series"),
            (86, 10.5, False, 16, "A geometric series with common ratio $r$ converges to the sum $\\frac{a}{1 - r}$ when $|r| < 1$,"),
            (86, 10.5, False, 15, "and the geometric series diverges whenever $|r| \\ge 1$."),
            (72, 10.5, False, 22, "Taylor Series refers to the power series representation $\\sum_{n=0}^{\\infty} \\frac{f^{(n)}(c)}{n!}(x - c)^{n}$."),
            (72, 10.5, False, 15, "As the degree $n$ of a Taylor polynomial increases, the truncation remainder decreases near the center $c$."),
        ]),
        flow_page([
            (72, 18, True, 20, "CHAPTER 3: Algorithms, Complexity, and Graph Theory"),
            (72, 13, True, 28, "3.1 Asymptotic Complexity, Recurrences, and Divide-and-Conquer"),
            (72, 10.5, False, 20, "Asymptotic Complexity is defined as the growth rate of an algorithm running time $T(n)$ as input size $n \\to \\infty$."),
            (72, 10.5, False, 15, "Merge sort runs in $O(n \\log n)$ time in the worst case by recursively sorting two subarrays of size $n/2$."),
            (72, 10.5, False, 15, "The recurrence for merge sort is $T(n) = 2T(n/2) + O(n)$."),
            (72, 10.5, False, 15, "The running time of binary search is $O(\\log n)$."),
            (86, 11, True, 24, "THEOREM 3.1 The Master Theorem"),
            (86, 10.5, False, 16, "For a divide-and-conquer recurrence $T(n) = aT(n/b) + \\Theta(n^{d})$ with constants $a \\ge 1$ and $b > 1$,"),
            (86, 10.5, False, 15, "if $d = \\log_{b} a$ then the asymptotic solution satisfies $T(n) = \\Theta(n^{d} \\log n)$."),
            (72, 10.5, False, 22, "Iterative binary search maintains midpoint $m = \\lfloor (low + high) / 2 \\rfloor$ and halves $[low, high]$."),
            (72, 13, True, 26, "3.2 Graph Traversals and Shortest-Path Algorithms"),
            (72, 10.5, False, 20, "Directed Acyclic Graph: A directed graph with no directed cycles that admits a linear topological ordering."),
            (72, 10.5, False, 15, "Binary Heap refers to a complete binary tree satisfying the heap-order property at every internal node."),
            (72, 10.5, False, 15, "Dijkstra's algorithm runs in $O((V + E) \\log V)$ time on weighted graphs with nonnegative edge weights."),
            (72, 10.5, False, 15, "When graph edge density increases toward $V^{2}$, adjacency-matrix lookup latency decreases relative to lists."),
        ]),
    ]
    build_pdf(book_pages, os.path.join(root_dir, "samples", "sample_textbook_chapters.pdf"))


if __name__ == "__main__":
    generate_samples(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    print("Generated sample PDFs in samples/")
