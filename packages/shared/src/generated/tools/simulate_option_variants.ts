/* Generated from contracts/schemas by scripts/generate-types.mjs - do not edit. */

/**
 * S1 - deterministic what-ifs. Policy ranges in GOV are applied server-side on top of these absolute caps; ALT_DESTINATION must be in the pack's candidate destinations; SPLIT parts must sum to the lot kg.
 */
export interface SIMULATE_OPTION_VARIANTSInput {
  run_id: string;
  case_id: string;
  /**
   * @minItems 1
   * @maxItems 5
   */
  base_option_ids:
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string];
  /**
   * @minItems 1
   * @maxItems 6
   */
  scenarios:
    | [
        {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        }
      ]
    | [
        {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        },
        {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        }
      ]
    | [
        {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        },
        {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        },
        {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        }
      ]
    | [
        {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        },
        {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        },
        {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        },
        {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        }
      ]
    | [
        {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        },
        {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        },
        {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        },
        {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        },
        {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        }
      ]
    | [
        {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        },
        {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        },
        {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        },
        {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        },
        {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        },
        {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        } & {
          [k: string]: unknown;
        }
      ];
}
