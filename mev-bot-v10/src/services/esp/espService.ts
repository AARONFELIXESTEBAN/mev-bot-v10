import * as tf from '@tensorflow/tfjs-node'; // For Node.js environment
import fs from 'fs/promises';
import path from 'path';
import { getLogger, PinoLogger } from '../../core/logger/loggerService';
import { ConfigService } from '../../core/config/configService'; // Removed AppConfig as it's not directly used here
import { Dict } from '@utils/typeUtils'; // Assuming Dict is defined in typeUtils like Dict<T> = {[key: string]: T}


interface ModelMetadata {
    model_name: string;
    model_type: string; // e.g., "neural_network"
    esp_model_version: string;
    feature_list_version: string;
    training_timestamp: string;
    evaluation_results: any;
    scaler_path: string;
    tfjs_model_path: string | null;
    native_model_path: string | null;
    feature_columns_ordered: string[];
    scaler_type?: "standard" | "minmax"; // Added from Python update
    scaler_params?: { // Added from Python update
        mean?: { [key: string]: number };
        scale?: { [key: string]: number }; // For StandardScaler, this is std_dev
        min?: { [key: string]: number };   // For MinMaxScaler
        max?: { [key: string]: number };   // For MinMaxScaler
    };
    numeric_features_scaled?: string[]; // Added from Python update: list of features the scaler was applied to
}

// ScalerParams type for internal use, derived from metadata
interface ScalerParamsInternal {
    type: "standard" | "minmax";
    mean: { [key: string]: number };
    scale: { [key: string]: number }; // std_dev for standard, (max-min) or 1/(max-min) for minmax (needs careful handling)
    min: { [key: string]: number };   // min for minmax
    max: { [key: string]: number };   // max for minmax
    numeric_features_scaled: string[]; // Which features to apply this to
}


export interface EspPredictionResult {
    executionSuccessProbability: number;
    predictedProfitabilityScore?: number;
    modelVersion: string;
    error?: string;
}

export class ESPMLService {
    private logger: PinoLogger;
    private model: tf.LayersModel | null = null;
    private metadata: ModelMetadata | null = null;
    private scalerParamsInternal: ScalerParamsInternal | null = null;
    private modelBasePath: string;
    private isInitialized: boolean = false;

    constructor(private configService: ConfigService) {
        this.logger = getLogger('ESPMLService');
        this.modelBasePath = this.configService.get('esp_model_config.model_base_path') as string || './trained_models_from_python';
        this.logger.info(`ESPMLService initialized. Model base path: ${this.modelBasePath}`);
    }

    public async init(): Promise<void> {
        this.logger.info("ESPMLService attempting to initialize and load model artifacts...");
        try {
            const latestMetadataFile = await this.findLatestModelMetadata(this.modelBasePath);
            if (!latestMetadataFile) {
                this.logger.error(`No model metadata file found in ${this.modelBasePath}. ESP Service cannot operate.`);
                this.isInitialized = false;
                return;
            }
            this.logger.info(`Found latest metadata file: ${latestMetadataFile}`);

            const metadataContent = await fs.readFile(path.join(this.modelBasePath, latestMetadataFile), 'utf-8');
            this.metadata = JSON.parse(metadataContent) as ModelMetadata;
            this.logger.info(`Loaded metadata for model: ${this.metadata.model_name}, version: ${this.metadata.esp_model_version}`);

            if (this.metadata.model_type !== "neural_network" || !this.metadata.tfjs_model_path) {
                this.logger.error(`Model type is '${this.metadata.model_type}'. Only 'neural_network' with a TF.js path is supported for inference. ESP Service cannot operate.`);
                this.isInitialized = false;
                return;
            }

            const tfjsModelDirName = path.basename(this.metadata.tfjs_model_path); // e.g., esp_model_neural_network_v1.0.0_YYYYMMDD_HHMMSS_tfjs
            const fullTfjsModelJsonPath = path.join(this.modelBasePath, tfjsModelDirName, 'model.json');

            this.logger.info(`Attempting to load TF.js model from: ${fullTfjsModelJsonPath}`);
            this.model = await tf.loadLayersModel(`file://${fullTfjsModelJsonPath}`);
            this.logger.info(`TensorFlow.js model loaded successfully: ${this.metadata.model_name}`);

            this.parseAndStoreScalerParams();

            if (!this.metadata.feature_columns_ordered || this.metadata.feature_columns_ordered.length === 0) {
                this.logger.error("Ordered feature list not found in metadata. Cannot prepare features. ESP Service cannot operate.");
                this.isInitialized = false;
                return;
            }

            this.isInitialized = true;
            this.logger.info("ESPMLService initialized successfully.");

        } catch (error) {
            this.logger.error({ err: error }, "Failed to initialize ESPMLService or load model artifacts.");
            this.isInitialized = false;
        }
    }

    private parseAndStoreScalerParams(): void {
        if (!this.metadata || !this.metadata.scaler_type || !this.metadata.scaler_params || !this.metadata.numeric_features_scaled) {
            this.logger.warn("Scaler type, parameters, or scaled feature list not found in metadata. Feature scaling will be effectively skipped or use defaults.");
            this.scalerParamsInternal = { type: "standard", mean: {}, scale: {}, min: {}, max: {}, numeric_features_scaled: [] }; // Dummy scaler
            return;
        }

        this.scalerParamsInternal = {
            type: this.metadata.scaler_type,
            mean: this.metadata.scaler_params.mean || {},
            scale: this.metadata.scaler_params.scale || {},
            min: this.metadata.scaler_params.min || {},
            max: this.metadata.scaler_params.max || {},
            numeric_features_scaled: this.metadata.numeric_features_scaled || []
        };
        this.logger.info(`Scaler parameters (${this.metadata.scaler_type}) parsed for ${this.scalerParamsInternal.numeric_features_scaled.length} features.`);
    }


    private async findLatestModelMetadata(dir: string): Promise<string | null> {
        try {
            const files = await fs.readdir(dir);
            const metadataFiles = files
                .filter(file => file.startsWith('esp_model_') && file.endsWith('_metadata.json'))
                .sort((a, b) => {
                    const timeA = a.substring(a.lastIndexOf('_', a.lastIndexOf('_metadata.json') -1 ) - 15, a.lastIndexOf('_metadata.json'));
                    const timeB = b.substring(b.lastIndexOf('_', b.lastIndexOf('_metadata.json') -1 ) - 15, b.lastIndexOf('_metadata.json'));
                    return timeB.localeCompare(timeA);
                });
            return metadataFiles.length > 0 ? metadataFiles[0] : null;
        } catch (error) {
            this.logger.error({err: error, directory: dir}, "Error finding latest model metadata file.");
            return null;
        }
    }

    public prepareFeatures(liveInputData: Dict<any>): tf.Tensor | null {
        if (!this.isInitialized || !this.metadata || !this.scalerParamsInternal) {
            this.logger.warn("ESPMLService not initialized or metadata/scaler missing. Cannot prepare features.");
            return null;
        }

        const orderedFeatures: number[] = [];
        let featuresProcessedCount = 0;

        for (const featureName of this.metadata.feature_columns_ordered) {
            let value = liveInputData[featureName];

            if (value === undefined || value === null || (typeof value === 'number' && isNaN(value))) {
                value = 0; // Default imputation for missing, align with Python's median/0 for safety
            }

            // Convert boolean to int if necessary (Python might send True/False)
            if (typeof value === 'boolean') {
                value = value ? 1 : 0;
            }


            if (this.scalerParamsInternal.numeric_features_scaled.includes(featureName)) {
                if (this.scalerParamsInternal.type === "standard") {
                    const mean = this.scalerParamsInternal.mean[featureName];
                    const scale = this.scalerParamsInternal.scale[featureName]; // This is std_dev
                    if (mean !== undefined && scale !== undefined) {
                        value = (scale === 0) ? 0 : (value - mean) / scale;
                    } else {
                        // this.logger.warn(`Standard scaler params missing for numeric feature '${featureName}'. Using original value.`);
                    }
                } else if (this.scalerParamsInternal.type === "minmax") {
                    const min = this.scalerParamsInternal.min[featureName];
                    const max = this.scalerParamsInternal.max[featureName];
                    if (min !== undefined && max !== undefined) {
                        const range = max - min;
                        value = (range === 0) ? 0 : (value - min) / range; // Scales to 0-1
                    } else {
                        // this.logger.warn(`MinMax scaler params missing for numeric feature '${featureName}'. Using original value.`);
                    }
                }
            }
            orderedFeatures.push(Number(value)); // Ensure it's a number
            featuresProcessedCount++;
        }

        if (featuresProcessedCount !== this.metadata.feature_columns_ordered.length) {
            this.logger.error(`Feature count mismatch. Expected ${this.metadata.feature_columns_ordered.length}, processed ${featuresProcessedCount}.`);
            return null;
        }

        return tf.tensor2d([orderedFeatures]);
    }

    public async predict(liveInputData: Dict<any>): Promise<EspPredictionResult> {
        if (!this.isInitialized || !this.model || !this.metadata) {
            const errorMsg = "ESPMLService not initialized or model/metadata not loaded.";
            this.logger.error(errorMsg);
            return { error: errorMsg, executionSuccessProbability: 0, modelVersion: this.metadata?.esp_model_version || "unknown" };
        }

        const featureTensor = this.prepareFeatures(liveInputData);
        if (!featureTensor) {
             const errorMsg = "Feature preparation failed.";
             this.logger.error(errorMsg);
            return { error: errorMsg, executionSuccessProbability: 0, modelVersion: this.metadata.esp_model_version };
        }

        try {
            const predictionTensor = this.model.predict(featureTensor) as tf.Tensor;
            const probabilityData = await predictionTensor.data();
            const probability = probabilityData[0];

            predictionTensor.dispose();
            featureTensor.dispose();

            this.logger.info({ probability, model: this.metadata.model_name }, "ESP Prediction successful.");
            return {
                executionSuccessProbability: probability,
                modelVersion: this.metadata.esp_model_version
            };
        } catch (error: any) {
            this.logger.error({ err: error }, "Error during ESP model prediction.");
            if (featureTensor && !featureTensor.isDisposed) featureTensor.dispose();
            return {
                error: error.message || "Prediction failed",
                executionSuccessProbability: 0,
                modelVersion: this.metadata.esp_model_version
            };
        }
    }

    public getModelVersion(): string | null {
        return this.metadata ? this.metadata.esp_model_version : null;
    }

    public getFeatureColumnsOrdered(): string[] | null {
        if (!this.isInitialized || !this.metadata) {
            this.logger.warn("ESPMLService not initialized or metadata missing. Cannot get feature columns.");
            return null;
        }
        return this.metadata.feature_columns_ordered;
    }
}
```
