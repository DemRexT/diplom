# Browser rendering libraries

Vendored distribution assets from the npm registry; no Node.js or CDN is required at runtime.

- mermaid 12.2.0: npm tarball integrity `sha512-w7nr/SFrLO7BaVTs3dQTvYSV6nYSBj0Yy9DjBhsIJtAcHqRzXSq4Pg32ujHZ/AdWsAMNEvvhbm5dt9E2tOiHzw==`.
- katex 0.19.0: npm tarball integrity `sha512-v6Tznz3zJ7u3niRCoDTsumM2+HA2XXcCu+WAacCeHD2z3p9A9Ks987o5FzfTGBN0e8A0vjEgIDvLbICrXpdw/Q==`.
- dompurify 3.4.17: npm tarball integrity `sha512-B/pSlYVHQ58kqISD/yDjuJ1yfzI34m1gF4lAod2bwSRhiN4K5Cl3H8Af7hqB2PmTL911tdEudnnXn5FnhRoz0w==`.

KaTeX renders mathematics with trust disabled. Mermaid runs in strict mode; generated SVG is additionally sanitized with DOMPurify. Fonts are served locally. Each package's license is included alongside its assets.

Distribution files are preserved byte-for-byte, including upstream whitespace and embedded license notices. Minified JavaScript bundles are marked as non-text diffs in .gitattributes; application source remains reviewable normally.
