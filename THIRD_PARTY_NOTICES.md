# Third-party notices

CloudMaru code is MIT licensed. Dependencies and bundled assets retain their
own copyrights and licenses.

## Source distribution

The GitHub source release contains CloudMaru code, its lockfile, third-party
notice texts and three CloudMaru screenshots captured from the synthetic
offline demo. Installers fetch dependencies from the locations pinned in the
lockfile. The inventory in `release/dependencies.json` records the declared
license and any collected notice files for each package.

The container and native installation notes below apply when you build or
install CloudMaru from this source.

## Where the exact license texts are

- **Container image**: `/app/third-party-licenses/` holds the license, notice,
  and copyright files of every installed production dependency and every
  package Next.js traced into the standalone server, copied at build time from
  the exact versions pinned in `package-lock.json`. Files are grouped as
  `<package>@<version>/…`. `manifest.json` lists each package's version,
  declared license, lockfile paths, whether it was traced, and SHA-256 of each
  copied text; `withoutLicenseText` lists packages that ship no such file
  (their declared license still applies, and their README is kept as
  attribution when present). The build fails if an installed or traced
  version differs from the lockfile. Full texts of common licenses named by
  SPDX identifier (Apache-2.0, GPL-3, LGPL-3, MPL-2.0) are in the base image
  under `/usr/share/common-licenses/`.
- **Native installation**: the same texts are in each installed package under
  `node_modules/<package>/`.

## Components with licenses other than MIT

Versions below are those pinned in `package-lock.json` for this release.

- **Pretendard 1.3.9** fonts (bundled into the web assets): SIL Open Font
  License 1.1 (OFL-1.1). Text: `pretendard@1.3.9/dist/LICENSE.txt` in the
  image, `node_modules/pretendard/dist/LICENSE.txt` natively. Font assets and
  the Reserved Font Names remain subject to that license.
- **PGlite 0.5.9** (`@electric-sql/pglite`): dual licensed Apache-2.0 or the
  PostgreSQL License, at the recipient's choice; changes to the PostgreSQL
  sources are under the PostgreSQL License. The npm package ships only the
  Apache-2.0 text, so the PostgreSQL License is reproduced below.
- **elkjs 0.12.1** (Mermaid layout): EPL-2.0 OR GPL-3.0-or-later; the container notices use the EPL-2.0 option. Source: <https://github.com/kieler/elkjs/tree/0.12.1>
  (compiled from the Eclipse Layout Kernel, <https://github.com/eclipse-elk/elk>).
- **DOMPurify 3.4.17**: MPL-2.0 OR Apache-2.0. The container notices use the Apache-2.0 option.
  Unmodified source: <https://github.com/cure53/DOMPurify/tree/3.4.17>.
- **caniuse-lite 1.0.30001815** (used by Next.js build tooling): data
  licensed CC-BY-4.0 from Can I use (<https://caniuse.com>) by Alexis Deveria.
- **fast-sha256 1.3.0** and **robust-predicates 3.0.3**: Unlicense.
- **sharp libvips binaries** (`@img/sharp-libvips-*` 1.3.4, optional Next.js
  image dependency, installed only for the build platform): LGPL-3.0-or-later.
  The library is a separate, dynamically loaded shared object that may be
  replaced. Its README (kept in the image as
  `@img/sharp-libvips-linux-<arch>@1.3.4/README.md`) lists the bundled
  libraries and their licenses (LGPLv3, MIT, BSD, MPL-1.1, zlib and others);
  LGPL-3 and GPL-3 texts are in `/usr/share/common-licenses/`. Corresponding source: <https://github.com/lovell/sharp-libvips/tree/v1.3.4>
  and <https://github.com/libvips/libvips>. Platform `@img/sharp-*` packages
  for Windows/WebAssembly add Apache-2.0 and MIT terms.
- Next.js, React, Radix UI, Mermaid, Zod and most other packages are MIT,
  ISC, BSD or Apache-2.0. Next.js vendors compiled dependencies with their
  license files under `next/dist/compiled/`, which are included above.
- Azure SDK packages and the Anthropic SDK retain their package notices.

## Microsoft Azure Bicep CLI

The container includes Bicep CLI 0.49.2, downloaded from the official release
<https://github.com/Azure/bicep/releases/tag/v0.49.2> and checked against a
pinned SHA-256. It is a self-contained .NET application; the .NET runtime it
embeds carries Microsoft's MIT-licensed notices
(<https://github.com/dotnet/runtime/blob/main/THIRD-PARTY-NOTICES.TXT>).
Bicep license (from `LICENSE` at tag v0.49.2):

```text
MIT License

Copyright (c) Microsoft Corporation.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE
```

## PostgreSQL License (PGlite)

From `POSTGRES-LICENSE` at tag `@electric-sql/pglite@0.5.9` of
<https://github.com/electric-sql/pglite>:

```text
PostgreSQL Database Management System
(formerly known as Postgres, then as Postgres95)

Portions Copyright (c) 1996-2021, PostgreSQL Global Development Group

Portions Copyright (c) 1994, The Regents of the University of California

Permission to use, copy, modify, and distribute this software and its
documentation for any purpose, without fee, and without a written agreement
is hereby granted, provided that the above copyright notice and this
paragraph and the following two paragraphs appear in all copies.

IN NO EVENT SHALL THE UNIVERSITY OF CALIFORNIA BE LIABLE TO ANY PARTY FOR
DIRECT, INDIRECT, SPECIAL, INCIDENTAL, OR CONSEQUENTIAL DAMAGES, INCLUDING
LOST PROFITS, ARISING OUT OF THE USE OF THIS SOFTWARE AND ITS
DOCUMENTATION, EVEN IF THE UNIVERSITY OF CALIFORNIA HAS BEEN ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.

THE UNIVERSITY OF CALIFORNIA SPECIFICALLY DISCLAIMS ANY WARRANTIES,
INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS FOR A PARTICULAR PURPOSE.  THE SOFTWARE PROVIDED HEREUNDER IS
ON AN "AS IS" BASIS, AND THE UNIVERSITY OF CALIFORNIA HAS NO OBLIGATIONS TO
PROVIDE MAINTENANCE, SUPPORT, UPDATES, ENHANCEMENTS, OR MODIFICATIONS.
```

## Base image and other content

The Node.js Debian base image contains separately licensed system components
(including ICU and CA certificates); their copyright files are under
`/usr/share/doc/` in the image. Review the image's package inventory for your
distribution requirements.

## Microsoft Azure documentation and catalog sources

The catalog credits Microsoft and the Microsoft Learn contributors. Each
reference architecture, assessment rule and regional support entry links to
its source where provided. CloudMaru summarizes and adapts the guidance,
including Korean translations and examples. Adapted material from
[Microsoft Azure documentation](https://github.com/MicrosoftDocs/azure-docs)
is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
where that license applies. Linked works and Microsoft trademarks retain
their respective terms.

The PostgreSQL storage entry in `src/catalog/components.json` also links to the
[Microsoft Azure CLI validator](https://github.com/Azure/azure-cli/blob/6b2d470a2da8e4f40ad681951f075b904d875a1d/src/azure-cli/azure/cli/command_modules/postgresql/utils/validators.py),
which the catalog cites for compatibility information.
[Azure CLI license at the cited revision](https://github.com/Azure/azure-cli/blob/6b2d470a2da8e4f40ad681951f075b904d875a1d/LICENSE).

Published price fixtures are synthetic. Operators sync Azure Retail Prices API
data to local storage under the
[Microsoft APIs Terms of Use](https://learn.microsoft.com/en-us/legal/microsoft-apis/terms-of-use).
