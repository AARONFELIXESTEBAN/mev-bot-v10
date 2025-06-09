import pandas as pd
import numpy as np
from typing import List, Dict, Any

# Helper function to safely get values from the espInputFeatures dictionary
def get_feature(data: Dict[str, Any], feature_name: str, default: Any = np.nan) -> Any:
    if not isinstance(data, dict):
        return default
    return data.get(feature_name, default)

def generate_features(raw_df: pd.DataFrame, feature_list_version: str) -> pd.DataFrame:
    """
    Generates features for the ESP model from the raw DataFrame.

    Args:
        raw_df (pd.DataFrame): DataFrame with raw data from Firestore,
                               including a column 'espInputFeatures' which is a dict,
                               and other columns like 'executionDetails.*'.
        feature_list_version (str): Version string for the feature list (e.g., "v1_0_SSOT_6_3_2").
                                     This can be used for conditional logic if features change.

    Returns:
        pd.DataFrame: DataFrame with engineered features and target variables.
    """
    print(f"Starting feature engineering for version: {feature_list_version}...")
    features_df = pd.DataFrame(index=raw_df.index) # Preserve index from raw_df

    # --- A. Opportunity-Specific Features (from espInputFeatures or direct columns) ---
    esp_input_col = 'espInputFeatures' if 'espInputFeatures' in raw_df.columns else None

    if esp_input_col:
        print(f"Processing features from '{esp_input_col}' column.")
        # Ensure espInputFeatures is a dict, handled by firestore_ingestor to be at least an empty dict.
    else:
        print(f"Warning: Column '{esp_input_col}' not found in raw_df. Many features will be NaN.")
        # Create an empty series of dicts if column doesn't exist to prevent errors in .apply()
        # This effectively means all get_feature calls on this series will return default.
        # A better approach is to ensure 'espInputFeatures' always exists, even if empty, from ingestion.
        # The firestore_ingestor.py was updated to ensure espInputFeatures is at least {}
        # so this specific 'else' for creating a dummy column might not be strictly needed if data quality is assured.
        # However, to be robust to unexpected missing column:
        if esp_input_col not in raw_df: # If column is truly missing
             raw_df[esp_input_col] = pd.Series([{} for _ in range(len(raw_df))], index=raw_df.index)


    # Example: Extracting features directly from the espInputFeatures dictionary
    # SSOT 6.3.2 - A. Opportunity-Specific Features
    features_df['A1_estimatedNetProfitUsd_PreEsp'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, 'estimatedNetProfitUsd_PreEsp'))
    features_df['A2_estimatedGasCostUsd_Initial'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, 'estimatedGasCostUsd_Initial'))
    features_df['A3_initialProfitToGasRatio'] = features_df['A1_estimatedNetProfitUsd_PreEsp'] / (features_df['A2_estimatedGasCostUsd_Initial'] + 1e-6)
    features_df['A4_pathLength'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, 'pathLength'))
    features_df['A5_usesFlashLoan'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, 'usesFlashLoan', default=0)).astype(int)
    features_df['A6_flashLoanAmountUsd'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, 'flashLoanAmountUsd'))
    features_df['A7_flashLoanFeeUsd_Estimate'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, 'flashLoanFeeUsd_Estimate'))
    features_df['A8_involvedTokenCount_Unique'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, 'involvedTokenCount_Unique'))
    features_df['A9_involvedDexCount_Unique'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, 'involvedDexCount_Unique'))

    CORE_TOKENS_PLACEHOLDER = ["WETH_ADDR", "USDC_ADDR", "USDT_ADDR"] # Placeholder - should come from config
    for i in range(3):
         features_df[f'A10_tokenIsCore_Token{i}'] = raw_df[esp_input_col].apply(
            lambda x: 1 if isinstance(get_feature(x, f'pathTokenAddress_{i}'), str) and get_feature(x, f'pathTokenAddress_{i}') in CORE_TOKENS_PLACEHOLDER else 0
        ).astype(int)

    features_df['A12_minPathLiquidityUsd'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, 'minPathLiquidityUsd'))
    features_df['A13_avgPathLiquidityUsd'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, 'avgPathLiquidityUsd'))
    features_df['A14_isCrossDexArbitrage'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, 'isCrossDexArbitrage', default=0)).astype(int)
    features_df['A15_opportunityAgeMs'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, 'opportunityAgeMs'))

    features_df['B16_currentBlockNumber'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, 'currentBlockNumber'))
    features_df['B17_currentBaseFeeGwei'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, 'currentBaseFeeGwei'))
    features_df['B18_botProposedMaxFeePerGasGwei'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, 'botProposedMaxFeePerGasGwei'))
    features_df['B19_botProposedMaxPriorityFeePerGasGwei'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, 'botProposedMaxPriorityFeePerGasGwei'))
    for i in range(1, 3):
        features_df[f'B20_botProposedSlippageToleranceBps_Swap{i}'] = raw_df[esp_input_col].apply(
            lambda x: get_feature(x, f'botProposedSlippageToleranceBps_Swap{i}')
        )

    features_df['C21_mempool_TotalPendingTxCount'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, 'mempool_TotalPendingTxCount'))
    features_df['C22_mempool_HighGasTxCount_LastMinute'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, 'mempool_HighGasTxCount_LastMinute'))
    for i in range(1, 3):
        features_df[f'C23_mempool_TargetPool_PendingTxCount_Swap{i}'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, f'mempool_TargetPool_PendingTxCount_Swap{i}'))
        features_df[f'C24_mempool_TargetPool_PendingVolumeUsd_Swap{i}'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, f'mempool_TargetPool_PendingVolumeUsd_Swap{i}'))
    features_df['C25_mempool_AvgPriorityFeeGwei_Recent'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, 'mempool_AvgPriorityFeeGwei_Recent'))
    features_df['C26_mempool_competingMevTxSignatureCount'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, 'mempool_competingMevTxSignatureCount'))
    features_df['C27_timeSinceLastBlockMs'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, 'timeSinceLastBlockMs'))
    features_df['C28_mempool_gasPriceVolatility_ShortTerm'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, 'mempool_gasPriceVolatility_ShortTerm'))

    features_df['D29_ethPriceUsd_Current'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, 'ethPriceUsd_Current'))
    for i in range(3):
        features_df[f'D30_tokenVolatility_StdDevPct_1min_Token{i}'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, f'tokenVolatility_StdDevPct_1min_Token{i}'))
        features_df[f'D31_tokenVolatility_StdDevPct_5min_Token{i}'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, f'tokenVolatility_StdDevPct_5min_Token{i}'))
    for i in range(1,3):
         features_df[f'D32_tokenLiquidityDeltaPct_5min_Pool{i-1}'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, f'tokenLiquidityDeltaPct_5min_Pool{i-1}'))
    features_df['D33_isNewTokenPair_Opportunistic'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, 'isNewTokenPair_Opportunistic', default=0)).astype(int)

    features_df['E34_bot_HistoricalSuccessRate_SamePathSignature_LastHour'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, 'bot_HistoricalSuccessRate_SamePathSignature_LastHour'))
    features_df['E35_bot_HistoricalSuccessRate_SameStrategyType_LastHour'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, 'bot_HistoricalSuccessRate_SameStrategyType_LastHour'))
    features_df['E36_bot_AvgNetProfitUsd_SamePathSignature_Successful_LastDay'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, 'bot_AvgNetProfitUsd_SamePathSignature_Successful_LastDay'))
    features_df['E37_bot_RecentConsecutiveFailures_ThisStrategy'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, 'bot_RecentConsecutiveFailures_ThisStrategy'))
    features_df['E38_bot_RelaySuccessRate_LastHour'] = raw_df[esp_input_col].apply(lambda x: get_feature(x, 'bot_RelaySuccessRate_LastHour'))

    if 'attemptTimestamp' in raw_df.columns:
        timestamps = pd.to_datetime(raw_df['attemptTimestamp'], errors='coerce')
        valid_timestamps_mask = timestamps.notna()

        # Initialize cyclical feature columns with np.nan or appropriate default
        features_df['F39_hourOfDayUTC_Sin'] = np.nan
        features_df['F39_hourOfDayUTC_Cos'] = np.nan
        features_df['F40_dayOfWeekUTC_Sin'] = np.nan
        features_df['F40_dayOfWeekUTC_Cos'] = np.nan

        if valid_timestamps_mask.any():
            hour_of_day = timestamps[valid_timestamps_mask].dt.hour
            day_of_week = timestamps[valid_timestamps_mask].dt.dayofweek

            features_df.loc[valid_timestamps_mask, 'F39_hourOfDayUTC_Sin'] = np.sin(2 * np.pi * hour_of_day / 24.0)
            features_df.loc[valid_timestamps_mask, 'F39_hourOfDayUTC_Cos'] = np.cos(2 * np.pi * hour_of_day / 24.0)
            features_df.loc[valid_timestamps_mask, 'F40_dayOfWeekUTC_Sin'] = np.sin(2 * np.pi * day_of_week / 7.0)
            features_df.loc[valid_timestamps_mask, 'F40_dayOfWeekUTC_Cos'] = np.cos(2 * np.pi * day_of_week / 7.0)
        else:
            print("Warning: No valid timestamps found in 'attemptTimestamp' column for cyclical features.")
    else:
        print("Warning: 'attemptTimestamp' column not found. Cannot generate cyclical time features.")
        features_df['F39_hourOfDayUTC_Sin'] = np.nan
        features_df['F39_hourOfDayUTC_Cos'] = np.nan
        features_df['F40_dayOfWeekUTC_Sin'] = np.nan
        features_df['F40_dayOfWeekUTC_Cos'] = np.nan


    # Pass through target variables (already created in main pipeline's labeling stage)
    if 'isSuccess_Execution' in raw_df.columns:
        features_df['isSuccess_Execution'] = raw_df['isSuccess_Execution']
    else:
        print("Warning: Target variable 'isSuccess_Execution' not found in raw_df. Defaulting to 0.")
        features_df['isSuccess_Execution'] = 0

    if 'isSuccess_Profitability' in raw_df.columns:
        features_df['isSuccess_Profitability'] = raw_df['isSuccess_Profitability']
    else:
        print("Warning: Target variable 'isSuccess_Profitability' not found in raw_df. Defaulting to 0.")
        features_df['isSuccess_Profitability'] = 0

    # Simple median imputation for numeric columns
    # More sophisticated imputation can be done in preprocessing module
    for col in features_df.columns:
        if features_df[col].isnull().any():
            if pd.api.types.is_numeric_dtype(features_df[col].dtype):
                median_val = features_df[col].median()
                features_df[col] = features_df[col].fillna(median_val)
                # print(f"Filled NaNs in numeric column '{col}' with median: {median_val}")
            else: # For non-numeric, fill with a placeholder or mode
                mode_val = features_df[col].mode()
                # If mode is empty (e.g. all NaN column), fill with 'missing'
                fill_val = mode_val[0] if not mode_val.empty else 'missing'
                features_df[col] = features_df[col].fillna(fill_val)
                # print(f"Filled NaNs in non-numeric column '{col}' with mode/placeholder: {fill_val}")


    print(f"Finished feature engineering. Output shape: {features_df.shape}")
    return features_df

if __name__ == '__main__':
    sample_data = [
        {
            "opportunityId": "opp1", "attemptTimestamp": pd.Timestamp("2023-01-01 10:00:00"),
            "espInputFeatures": {
                "estimatedNetProfitUsd_PreEsp": 100.0, "estimatedGasCostUsd_Initial": 10.0,
                "pathLength": 2, "usesFlashLoan": 1, "flashLoanAmountUsd": 10000,
                "currentBlockNumber": 15000000, "botProposedMaxFeePerGasGwei": 50,
                "mempool_TotalPendingTxCount": 500, "timeSinceLastBlockMs": 3000,
                "ethPriceUsd_Current": 2000.0, "pathTokenAddress_0": "WETH_ADDR",
            },
            "executionDetails.executionStatus": "SUCCESS_ON_CHAIN", # Example direct column
            "executionDetails.actualNetProfitLossUsd": 90.0      # Example direct column
        },
        {
            "opportunityId": "opp2", "attemptTimestamp": pd.Timestamp("2023-01-01 14:30:00"),
            "espInputFeatures": {
                "estimatedNetProfitUsd_PreEsp": 5.0, "estimatedGasCostUsd_Initial": 8.0,
                "pathLength": 2, "usesFlashLoan": 0, "flashLoanAmountUsd": 0, # Explicit 0
                "currentBlockNumber": 15000010, "botProposedMaxFeePerGasGwei": 40,
                "mempool_TotalPendingTxCount": 300, "timeSinceLastBlockMs": 8000,
                "ethPriceUsd_Current": 2010.0, "pathTokenAddress_0": "SOME_OTHER_TOKEN",
            },
            "executionDetails.executionStatus": "REVERTED",
            "executionDetails.actualNetProfitLossUsd": -8.0
        },
        {
            "opportunityId": "opp3", "attemptTimestamp": pd.Timestamp("2023-01-01 16:00:00"),
            "espInputFeatures": None, # Missing features for this row
            "executionDetails.executionStatus": "DROPPED",
            "executionDetails.actualNetProfitLossUsd": 0.0
        }
    ]

    # Correctly prepare raw_df_sample as firestore_ingestor would
    raw_df_sample = pd.json_normalize(sample_data, sep='.')
    # Ensure 'espInputFeatures' column exists, even if it contains None/NaN for some rows
    # The firestore_ingestor is now designed to make espInputFeatures at least {}
    # For this test, we manually ensure it's what generate_features expects.
    if 'espInputFeatures' not in raw_df_sample.columns:
        raw_df_sample['espInputFeatures'] = pd.Series([None] * len(raw_df_sample), index=raw_df_sample.index)

    # Ensure espInputFeatures column contains dictionaries, default to empty if not
    def ensure_dict(item):
        if isinstance(item, dict):
            return item
        return {} # Default to empty dict for NaN, None, or other types
    raw_df_sample['espInputFeatures'] = raw_df_sample['espInputFeatures'].apply(ensure_dict)


    # Add target variables as they would be after labeling step in main pipeline
    raw_df_sample["isSuccess_Execution"] = raw_df_sample['executionDetails.executionStatus'].apply(
        lambda x: 1 if x == "SUCCESS_ON_CHAIN" else 0
    )
    raw_df_sample["isSuccess_Profitability"] = raw_df_sample['executionDetails.actualNetProfitLossUsd'].apply(
        lambda x: 1 if pd.notna(x) and x > 1.0 else 0
    )

    print("Sample Raw DataFrame for feature_generator (after potential json_normalize and espInputFeatures handling):")
    print(raw_df_sample.head(5))
    raw_df_sample.info()

    engineered_features_df = generate_features(raw_df_sample, "v1_0_SSOT_6_3_2")

    print("\nEngineered Features DataFrame head:")
    print(engineered_features_df.head(5))
    print("\nEngineered Features DataFrame Info:")
    engineered_features_df.info()
    print("\nNaN counts per column in engineered features:")
    print(engineered_features_df.isnull().sum())
    print("\nExample row for opp1:")
    print(engineered_features_df[engineered_features_df.index == 0].iloc[0])
    print("\nExample row for opp3 (missing espInputFeatures):")
    print(engineered_features_df[engineered_features_df.index == 2].iloc[0])

```
