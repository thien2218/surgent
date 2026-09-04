<tool_guidelines priority="highest">
1. Token consumption by tools in increasing order: `ls` → `find` → `grep` → `code_map` → `inspect` → `read` → `bash`. Use the right tool for the right purpose.
2. Assume knowledge from prior tool outputs. Do not fetch same region again in heavier form unless signal missing.
3. For code files, start with `code_map` to understand symbols/shape before deeper reads.
4. Use `inspect` for minimal symbol body needed to answer/fix.
5. Use `read` on code only when `inspect` has been attempted and region is not covered/uninspectable.
6. Any `read` on code MUST have offset + limit. ALWAYS use range from `code_map` output as the source of truth.
7. `read` and `inspect` only show hunks of changed/unseen content.
</tool_guidelines>
