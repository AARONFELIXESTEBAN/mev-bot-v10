import * as tf from '@tensorflow/tfjs';
import fs from 'fs/promises';
import path from 'path';
import { getLogger, PinoLogger } from '@core/logger/loggerService';
import { ConfigService } from '@core/config/configService';
import { Dict } from '@utils/typeUtils';

interface ModelMetadata {
    model_name: string;
    model_type: string;
    esp_model_version: string;
    feature_list_version: string;
    training_timestamp: string;
    evaluation_results: any;
    scaler_path: string;
    tfjs_model_path: string | null;
    native_model_path: string | null;
    feature_columns_ordered: string[];
    scaler_type?: "standard" | "minmax";
    scaler_params?: {
        mean?: { [key: string]: number };
        scale?: { [key: string]: number };
        min?: { [key: string]: number };
        max?: { [key: string]: number };
    };
    numeric_features_scaled?: string[];
}

interface ScalerParamsInternal {
    type: "standard" | "minmax";
    mean: { [key: string]: number };
    scale: { [key: string]: number };
    min: { [key: string]: number };
    max: { [key: string]: number };
    numeric_features_scaled: string[];
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

            const tfjsModelDirName = path.basename(this.metadata.tfjs_model_path);
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
        } catch (error: any) {
            this.logger.error({ err: error.message }, "Failed to initialize ESPMLService or load model artifacts.");
            this.isInitialized = false;
        }
    }

    private parseAndStoreScalerParams(): void {
        if (!this.metadata || !this.metadata.scaler_type || !this.metadata.scaler_params || !this.metadata.numeric_features_scaled) {
            this.logger.warn("Scaler type, parameters, or scaled feature list not found in metadata. Feature scaling will be effectively skipped or use defaults.");
            this.scalerParamsInternal = { type: "standard", mean: {}, scale: {}, min: {}, max: {}, numeric_features_scaled: [] };
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
                    const partsA = a.replace('_metadata.json', '').split('_');
                    const timeA = partsA.length >= 2 ? partsA.slice(-2).join('_') : "";
                    const partsB = b.replace('_metadata.json', '').split('_');
                    const timeB = partsB.length >= 2 ? partsB.slice(-2).join('_') : "";
                    return timeB.localeCompare(timeA);
                });
            return metadataFiles.length > 0 ? metadataFiles[0] : null;
        } catch (error: any) {
            this.logger.error({ err: error.message, directory: dir }, "Error finding latest model metadata file.");
            return null;
        }
    }

    public prepareFeatures(liveInputData: Dict): tf.Tensor | null {
        if (!this.isInitialized || !this.metadata || !this.scalerParamsInternal) {
            this.logger.warn("ESPMLService not initialized or metadata/scaler missing. Cannot prepare features.");
            return null;
        }

        const orderedFeatures: number[] = [];
        let featuresProcessedCount = 0;

        for (const featureName of this.metadata.feature_columns_ordered) {
            let value = liveInputData[featureName];

            if (value === undefined || value === null || (typeof value === 'number' && isNaN(value))) {
                value = 0;
            }

            if (typeof value === 'boolean') {
                value = value ? 1 : 0;
            }

            if (this.scalerParamsInternal.numeric_features_scaled.includes(featureName)) {
                if (this.scalerParamsInternal.type === "standard") {
                    const mean = this.scalerParamsInternal.mean[featureName];
                    const scale = this.scalerParamsInternal.scale[featureName];
                    if (mean !== undefined && scale !== undefined) {
                        value = (scale === 0) ? 0 : (value - mean) / scale;
                    }
                } else if (this.scalerParamsInternal.type === "minmax") {
                    const min = this.scalerParamsInternal.min[featureName];
                    const max = this.scalerParamsInternal.max[featureName];
                    if (min !== undefined && max !== undefined) {
                        const range = max - min;
                        value = (range === 0) ? 0 : (value - min) / range;
                    }
                }
            }
            orderedFeatures.push(Number(value));
            featuresProcessedCount++;
        }

        if (featuresProcessedCount !== this.metadata.feature_columns_ordered.length) {
            this.logger.error(`Feature count mismatch. Expected ${this.metadata.feature_columns_ordered.length}, processed ${featuresProcessedCount}.`);
            return null;
        }

        return tf.tensor2d([orderedFeatures]);
    }

    public async predict(liveInputData: Dict): Promise<EspPredictionResult> {
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
            this.logger.error({ err: error.message }, "Error during ESP model prediction.");
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